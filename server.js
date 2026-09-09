// ============================================================
// FACTURA-BOT
// Recibe una foto o PDF de una factura por WhatsApp,
// extrae los datos con Claude (Anthropic) y los guarda en
// una fila nueva de Google Sheets.
// ============================================================

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const {
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN,
  ANTHROPIC_API_KEY,
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_JSON,
  PORT,
} = process.env;

const GRAPH_API_VERSION = 'v21.0';

// ------------------------------------------------------------
// 1. VERIFICACIÓN DEL WEBHOOK (Meta hace este GET una sola vez
//    cuando configuras la URL del webhook)
// ------------------------------------------------------------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verificado correctamente.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ------------------------------------------------------------
// 2. RECEPCIÓN DE MENSAJES DE WHATSAPP
// ------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  // Le respondemos a Meta de inmediato (si tardamos, reintenta el envío)
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) return; // Puede ser un evento de "leído", lo ignoramos

    const fromNumber = message.from;
    const messageType = message.type; // 'image', 'document', 'text', etc.

    if (messageType !== 'image' && messageType !== 'document') {
      await enviarMensajeWhatsApp(
        fromNumber,
        'Envíame una *foto* o un *PDF* de la factura y la registro automáticamente. 📄'
      );
      return;
    }

    const mediaId =
      messageType === 'image' ? message.image.id : message.document.id;

    await enviarMensajeWhatsApp(fromNumber, '📥 Recibido, procesando tu factura...');

    // Paso 1: descargar el archivo desde los servidores de WhatsApp
    const { buffer, mimeType } = await descargarMedia(mediaId);

    // Paso 2: extraer los datos de la factura con Claude
    const datos = await extraerDatosFactura(buffer, mimeType);

    // Paso 3: guardar en Google Sheets
    await guardarEnGoogleSheets(datos, fromNumber);

    // Paso 4: confirmar al usuario
    const resumen =
      `✅ Factura registrada:\n` +
      `🏢 Proveedor: ${datos.proveedor}\n` +
      `🧾 N° factura: ${datos.numero_factura}\n` +
      `📅 Fecha: ${datos.fecha_factura}\n` +
      `💰 Subtotal: ${datos.subtotal}\n` +
      `📊 ITBMS: ${datos.itbms}\n` +
      `💵 Total: ${datos.total}\n` +
      `🏷️ Categoría: ${datos.categoria}`;

    await enviarMensajeWhatsApp(fromNumber, resumen);
  } catch (error) {
    console.error('Error procesando el mensaje:', error?.response?.data || error);
    try {
      const fromNumber = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (fromNumber) {
        await enviarMensajeWhatsApp(
          fromNumber,
          '⚠️ No pude procesar esa factura. ¿Puedes intentar con una foto más clara o el PDF original?'
        );
      }
    } catch (e) {
      console.error('No se pudo avisar del error al usuario:', e);
    }
  }
});

// ------------------------------------------------------------
// Descarga el archivo multimedia desde la API de WhatsApp
// ------------------------------------------------------------
async function descargarMedia(mediaId) {
  const metaResponse = await axios.get(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );

  const { url, mime_type } = metaResponse.data;

  const fileResponse = await axios.get(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer',
  });

  return { buffer: Buffer.from(fileResponse.data), mimeType: mime_type };
}

// ------------------------------------------------------------
// Envía la imagen/PDF a Claude y le pide los datos en JSON
// ------------------------------------------------------------
async function extraerDatosFactura(buffer, mimeType) {
  const base64Data = buffer.toString('base64');
  const esPDF = mimeType.includes('pdf');

  const contentBlock = esPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } };

  const prompt = `Esta es una factura o recibo. Extrae los siguientes datos y responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, sin backticks:

{
  "proveedor": "nombre del negocio o proveedor que emite la factura",
  "ruc_cedula": "RUC o cédula del proveedor, o 'N/A' si no aparece",
  "numero_factura": "número o folio de la factura, o 'N/A'",
  "fecha_factura": "fecha de la factura en formato DD/MM/AAAA, o 'N/A' si no se ve",
  "descripcion": "breve descripción de lo comprado o el servicio (máximo 8 palabras)",
  "subtotal": "monto antes de impuestos, como número sin símbolo de moneda (ej: 100.00). Si no aparece por separado, usa el mismo valor que el total",
  "itbms": "monto del impuesto (ITBMS/IVA) como número, o 0 si no aparece",
  "total": "monto total final como número, sin símbolo de moneda (ej: 107.00)",
  "metodo_pago": "método de pago si es visible en la factura (ej: Efectivo, Transferencia, Tarjeta, Yappy), o 'N/A' si no se indica",
  "categoria": "una categoría breve inferida del tipo de gasto, ej: Alimentación, Transporte, Servicios, Suministros, Oficina, Otro"
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [contentBlock, { type: 'text', text: prompt }],
        },
      ],
    },
    {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );

  const textoRespuesta = response.data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
  return JSON.parse(limpio);
}

// ------------------------------------------------------------
// Agrega una fila nueva a Google Sheets con los datos extraídos
// ------------------------------------------------------------
async function guardarEnGoogleSheets(datos, remitente) {
  const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: 'Facturas!A:N',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          new Date().toLocaleDateString('es-PA'), // A: Fecha recepción
          datos.proveedor, // B: Proveedor
          datos.ruc_cedula, // C: RUC/Cédula
          datos.numero_factura, // D: N.° factura
          datos.fecha_factura, // E: Fecha factura
          datos.descripcion, // F: Descripción
          datos.subtotal, // G: Subtotal
          datos.itbms, // H: ITBMS
          datos.total, // I: Total
          datos.metodo_pago, // J: Método de pago
          datos.categoria, // K: Categoría
          'Pendiente', // L: Estado
          'WhatsApp', // M: Archivo/WhatsApp
          `Registrado por ${remitente}`, // N: Observaciones
        ],
      ],
    },
  });
}

// ------------------------------------------------------------
// Envía un mensaje de texto de vuelta al usuario por WhatsApp
// ------------------------------------------------------------
async function enviarMensajeWhatsApp(to, texto) {
  await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: texto },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// ------------------------------------------------------------
app.get('/', (req, res) => {
  res.send('Factura-bot está funcionando ✅');
});

// ------------------------------------------------------------
// RUTA TEMPORAL DE PRUEBA
// Visita https://TU-URL-DE-RENDER.onrender.com/test-sheets
// en el navegador para verificar que el bot puede escribir
// en tu Google Sheet, sin necesitar WhatsApp todavía.
// (Puedes borrar esta ruta más adelante, no es obligatoria)
// ------------------------------------------------------------
app.get('/test-sheets', async (req, res) => {
  try {
    const datosDePrueba = {
      proveedor: 'Proveedor de Prueba',
      ruc_cedula: '0000-0000-000000',
      numero_factura: 'TEST-001',
      fecha_factura: new Date().toLocaleDateString('es-PA'),
      descripcion: 'Prueba de conexión del bot',
      subtotal: '93.00',
      itbms: '6.99',
      total: '99.99',
      metodo_pago: 'N/A',
      categoria: 'Prueba',
    };

    await guardarEnGoogleSheets(datosDePrueba, 'test-manual');

    res.send(
      '✅ ¡Funcionó! Se agregó una fila de prueba a tu Google Sheet. Ve a revisarla, y si la ves, todo está bien conectado. (Puedes borrar esa fila de prueba después).'
    );
  } catch (error) {
    console.error('Error en /test-sheets:', error?.response?.data || error.message || error);
    res.status(500).send(
      '❌ Hubo un error escribiendo en Google Sheets: ' +
        (error?.response?.data?.error?.message || error.message || 'Error desconocido') +
        '\n\nRevisa: 1) que GOOGLE_SHEET_ID sea correcto, 2) que GOOGLE_SERVICE_ACCOUNT_JSON esté bien pegado, 3) que compartiste la hoja con el email de la cuenta de servicio como Editor, 4) que la pestaña se llame exactamente "Facturas".'
    );
  }
});

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});
