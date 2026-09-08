# 🧾 Factura-Bot — Registra tus facturas por WhatsApp

Este bot recibe una foto o PDF de una factura por WhatsApp, lee los datos con IA (Claude) y los guarda automáticamente en una fila de tu Google Sheet.

Sigue esta guía en orden. No necesitas saber programar, solo copiar y pegar.

---

## Parte 1: Crea tu Google Sheet

1. Ve a [sheets.google.com](https://sheets.google.com) y crea una hoja nueva.
2. Ponle de nombre a la pestaña de abajo (la que dice "Hoja 1") el nombre **Facturas** (exactamente así, con mayúscula).
3. En la primera fila, escribe estos encabezados, uno por columna (de A a I):
   `Fecha de registro | Fecha factura | Proveedor | N° Factura | Monto | Moneda | Impuesto | Categoría | Remitente`
4. Copia el **ID de la hoja**: está en la URL, entre `/d/` y `/edit`.
   Ejemplo: `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit` → guarda ese ID, lo usarás después.

---

## Parte 2: Crea la cuenta de servicio de Google (para que el bot pueda escribir en tu Sheet)

1. Ve a [console.cloud.google.com](https://console.cloud.google.com) y crea un proyecto nuevo (cualquier nombre).
2. En el buscador de arriba escribe **"Google Sheets API"** y haz clic en **Habilitar**.
3. Ve al menú ☰ → **APIs y servicios** → **Credenciales**.
4. Haz clic en **Crear credenciales** → **Cuenta de servicio**. Ponle un nombre (ej. "factura-bot") y crea.
5. Dentro de la cuenta de servicio creada, ve a la pestaña **Claves** → **Agregar clave** → **Crear clave nueva** → tipo **JSON**. Se descargará un archivo `.json` — guárdalo, lo necesitarás pronto.
6. Copia el "email" de la cuenta de servicio (se ve como `algo@tu-proyecto.iam.gserviceaccount.com`, aparece en la página de la cuenta de servicio).
7. Vuelve a tu Google Sheet, haz clic en **Compartir**, y comparte la hoja con ese email, dándole permiso de **Editor**.

---

## Parte 3: Crea tu app de WhatsApp Business en Meta

1. Ve a [developers.facebook.com](https://developers.facebook.com) e inicia sesión con tu cuenta de Facebook.
2. Crea una **App nueva** → elige tipo **Negocio**.
3. Dentro de tu app, busca el producto **WhatsApp** y agrégalo.
4. En la sección de WhatsApp → **Configuración de la API**, verás:
   - Un **token de acceso temporal** (para pruebas). Más adelante generamos uno permanente.
   - Un **Phone Number ID** — cópialo, lo necesitarás.
5. Para agregar tu propio número (el que conseguiste): en la misma sección, haz clic en **Agregar número de teléfono** y sigue los pasos de verificación (te llega un código por SMS o llamada).
   ⚠️ Ese número **no puede tener WhatsApp activo actualmente** — si ya lo tiene, primero debes eliminar la cuenta de WhatsApp de ese número desde la app de WhatsApp normal.
6. Para un token que no expire cada 24 horas: ve a **Configuración de la Empresa** → **Usuarios del sistema** → crea un usuario del sistema → genera un token de acceso permanente con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.

---

## Parte 4: Sube el proyecto y despliégalo (Render, gratis)

1. Ve a [render.com](https://render.com) y crea una cuenta gratis.
2. Crea un **New Web Service**.
3. Cuando te pida el código: la forma más simple es subir estos archivos a un repositorio nuevo en [github.com](https://github.com) (crea uno, sube los 3 archivos: `server.js`, `package.json`, `.env.example`), y luego conectas ese repositorio en Render.
4. Configuración en Render:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
5. En la sección **Environment** de Render, agrega estas variables (los valores que fuiste guardando en las partes anteriores):
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_VERIFY_TOKEN` → invéntate cualquier palabra, ej: `mifactura2026`
   - `ANTHROPIC_API_KEY` → la obtienes en [console.anthropic.com](https://console.anthropic.com)
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` → abre el archivo `.json` que descargaste, copia TODO su contenido y pégalo aquí como una sola línea
6. Haz clic en **Deploy**. Cuando termine, Render te da una URL tipo `https://factura-bot-xxxx.onrender.com`.

---

## Parte 5: Conecta el webhook en Meta

1. Vuelve a tu app en developers.facebook.com → WhatsApp → **Configuración**.
2. En **Webhook**, haz clic en **Editar** y pon:
   - **URL de callback:** `https://factura-bot-xxxx.onrender.com/webhook` (usa tu URL real de Render)
   - **Verify token:** el mismo que pusiste en `WHATSAPP_VERIFY_TOKEN`
3. Haz clic en **Verificar y guardar**.
4. Justo debajo, en **Campos del Webhook**, suscríbete al campo **messages**.

---

## Parte 6: ¡Pruébalo!

Desde tu celular, manda una foto de una factura al número que configuraste. En unos segundos deberías recibir la confirmación por WhatsApp, y ver la fila nueva en tu Google Sheet. 🎉

---

## Si algo falla

- **"No pude procesar esa factura"**: prueba con una foto más nítida, bien iluminada, o el PDF original.
- **El webhook no verifica**: revisa que el `WHATSAPP_VERIFY_TOKEN` sea idéntico en Meta y en Render.
- **No escribe en el Sheet**: revisa que compartiste la hoja con el email de la cuenta de servicio, y que el nombre de la pestaña sea exactamente `Facturas`.
- Si te trabas en cualquier paso, pégame el mensaje de error exacto y seguimos desde ahí.
