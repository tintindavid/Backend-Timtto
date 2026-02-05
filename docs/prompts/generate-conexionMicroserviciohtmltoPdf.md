# 🤖 COPILOT AUTO-IMPLEMENTATION GUIDE
## Generación Masiva de PDFs con Microservicio

> **INSTRUCCIONES:** Copia los prompts de este archivo en los archivos correspondientes de tu backend.
> Copilot generará automáticamente todo el código necesario.

---

## 📋 CONTEXTO DEL PROYECTO

**Backend Actual:**
- Node.js + Express + MongoDB
- Colección: `reports` (reportes de mantenimiento)
- Microservicio PDF ya desarrollado y funcionando

**Microservicio PDF:**
- URL: `http://localhost:3000` (ajustar según tu caso)
- Endpoint: `POST /api/pdf`
- Recibe: `{ html: string, options: object }`
- Devuelve: PDF en formato binario (arraybuffer)

**Objetivo:**
Generar múltiples PDFs desde report de MongoDB y descargarlos en un archivo ZIP.

---

El sistema puede recibir del front generar pdf desde una ot y en este caso se generan pdf solo  de los report de la ot que este en estado Cerrado o Cancelado

tambien puede recibir generar pdf desde una Worksheet en este caso genera reporte desde los report de la misma hoja.

tambien puede recibir generar pdf desde un unico report.

en cualquiera de los casos se debe consultar por cada report si hay repuestos asociados ya que hacen parte del report.

## 📦 PASO 1: INSTALAR DEPENDENCIAS

```bash
npm install jszip
```

---

## ⚙️ PASO 2: CONFIGURAR VARIABLES DE ENTORNO

Agregar en tu archivo `.env`:

```env
# Microservicio de PDF
PDF_SERVICE_URL=http://localhost:3000/api/pdf 
PDF_MICROSERVICE_TIMEOUT=30000
```

---

## 📁 PASO 3: CREAR ARCHIVOS

### 📄 Archivo 1: `services/pdfMicroserviceClient.js`

**COPIAR ESTE PROMPT EN EL ARCHIVO VACÍO:**

```javascript
/*
COPILOT: Genera un cliente para conectar con el microservicio de PDF

REQUISITOS:
- Importar axios
- Clase PDFMicroserviceClient con constructor que reciba config opcional
- Config por defecto: { url: process.env.PDF_SERVICE_URL, timeout: 30000 }
- Método async generatePDF(html, options = {}) que:
  * Haga POST a this.config.url
  * Body: { html: html, options: { format: 'A4', landscape: false, printBackground: true, margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' }, ...options } }
  * Headers: { 'Content-Type': 'application/json' }
  * responseType: 'arraybuffer'
  * timeout: this.config.timeout
  * Retorne Buffer.from(response.data)
  * Maneje errores con try-catch
- Método async healthCheck() que:
  * Extraiga la URL base (sin /api/pdf)
  * Haga GET a /health
  * Retorne true si status 200, false si error
- Método handleError(error) que retorne Error con mensaje descriptivo según:
  * Si error.response: "Microservicio PDF: {status} - {statusText}"
  * Si error.request: "Microservicio PDF no responde"
  * Otro: "Error al generar PDF: {message}"
- Exportar la clase

EJEMPLO DE USO:
const client = new PDFMicroserviceClient();
const pdfBuffer = await client.generatePDF(htmlString);
*/
```

---

### 📄 Archivo 2: `services/bulkPDFGenerator.js`


```javascript
/*
COPILOT: Genera un servicio para crear múltiples PDFs y empaquetarlos en ZIP

REQUISITOS:
- Importar JSZip y PDFMicroserviceClient del archivo anterior
- Clase BulkPDFGenerator con constructor que reciba pdfClient opcional
- Si no se pasa pdfClient, crear instancia de PDFMicroserviceClient()
- Método async generateBulkPDFs(reports, htmlGenerator) que:
  * Cree instancia de JSZip()
  * Cree objeto results = { successful: 0, failed: 0, errors: [] }
  * Haga console.log con "Iniciando generación de X PDFs"
  * Llame a this.pdfClient.healthCheck() y lance error si retorna false
  * Itere sobre reports con for loop (NO map, debe ser secuencial)
  * Para cada report:
    - Loguee "Procesando {i+1}/{total} - Reporte: {numeroReporte}"
    - En try-catch:
      * Llame htmlGenerator(report) para obtener HTML
      * Llame this.pdfClient.generatePDF(html) para obtener buffer
      * Genere nombre: "{numeroReporte}_{timestamp}.pdf"
      * Agregue al zip: zip.file(fileName, pdfBuffer)
      * Incremente results.successful
      * Loguee "✅ PDF generado: {fileName}"
    - En catch:
      * Incremente results.failed
      * Agregue a results.errors: { reportId, numeroReporte, error: error.message }
      * Loguee "❌ Error: {error.message}"
      * Agregue archivo de error al ZIP: "ERROR_{numeroReporte}.txt" con el mensaje
  * Después del loop, genere ZIP con: zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  * Llame this.printSummary(results, zipBuffer.length)
  * Retorne zipBuffer
- Método generateFileName(report, index) que retorne string con formato seguro
- Método printSummary(results, zipSize) que imprima en consola:
  * Línea de separación con "═══════"
  * "RESUMEN DE GENERACIÓN"
  * Exitosos, Fallidos, Tamaño del ZIP en MB
  * Lista de errores si existen
- Exportar la clase

EJEMPLO DE USO:
const generator = new BulkPDFGenerator();
const zipBuffer = await generator.generateBulkPDFs(reports, (r) => generateHTML(r));
*/
```

---

### 📄 Archivo 3: `utils/htmlTemplateGenerator.js`

**COPIAR ESTE PROMPT EN EL ARCHIVO VACÍO:**

```javascript
/*
COPILOT: Genera utilidad para convertir reportes en HTML

REQUISITOS:
- Función getHTMLTemplate() que retorne string con template HTML:
  * DOCTYPE html con lang="es"
  * Head con charset UTF-8 y title "Reporte de Servicio - BIOLMEC"
  * Estilos CSS inline con:
    - body: margin 0, padding 20px 40px, font Arial, background #eef2f7
    - @page: size A4 portrait, margin 10mm
    - .header: background linear-gradient #003B73 a #0074C7, color white, padding 20px, border-radius 10px
    - .header h1: margin 0, font-size 24px
    - .info-cards: display flex, gap 8px, flex-wrap
    - .info-card: background white, padding 10px, border-radius 8px, border-left 4px solid #0074C7
    - .section: margin-top 20px
    - .section-header: border-bottom 2px solid #0074C7, font-size 18px, font-weight bold
    - .info-grid: display grid, grid-template-columns repeat(2, 1fr), gap 10px
    - .actividad-item: background #eef5ff, padding 8px, border-radius 6px, border-left 4px solid #0074C7, margin-bottom 6px
    - .observaciones-box: background #f3f6fa, padding 12px, border-radius 8px
    - .firma-section: display flex, justify-content space-around, margin-top 30px
    - .firma-box: text-align center, border-top 2px solid #003B73, padding-top 10px
  * Body con estructura:
    - Header con logo, título "BIOLMEC SAS", subtítulo "REPORTE DE SERVICIO TÉCNICO"
    - Cards de info: Reporte, OT, Fecha, Tipo, Estado (usar placeholders {{variable}})
    - Sección Cliente: nombre, NIT, ciudad, dirección, teléfono, contacto
    - Sección Equipo: nombre, marca, modelo, serial, inventario, servicio, ubicación
    - Sección Actividades: lista de actividades
    - Sección Observaciones
    - Sección Firmas: Técnico y Cliente
  * Usar placeholders: {{numeroReporte}}, {{numeroOT}}, {{fecha}}, {{tipoServicio}}, {{estado}}, {{clienteNombre}}, etc.

- Función generateHTMLFromReport(report, template) que:
  * Tome el template y reemplace TODOS los placeholders con datos del report
  * Use operador ?? para valores por defecto 'N/A'
  * Para actividades: si report.actividades existe y tiene length, mapear a HTML, sino "No se registraron actividades"
  * Para fecha: formatear con new Date(report.fecha).toLocaleDateString('es-CO')
  * Retorne el HTML completo

- Función helper formatDate(date) para formatear fechas

- Exportar { getHTMLTemplate, generateHTMLFromReport }

PLACEHOLDERS A USAR:
{{numeroReporte}}, {{numeroOT}}, {{fecha}}, {{tipoServicio}}, {{estado}}
{{clienteNombre}}, {{clienteNit}}, {{clienteCiudad}}, {{clienteDireccion}}, {{clienteTelefono}}, {{clienteContacto}}
{{equipoNombre}}, {{equipoMarca}}, {{equipoModelo}}, {{equipoSerial}}, {{equipoInventario}}, {{equipoServicio}}, {{equipoUbicacion}}
{{actividades}}, {{observaciones}}
{{tecnicoNombre}}, {{tecnicoCargo}}, {{clienteFirmaNombre}}, {{clienteFirmaCargo}}
*/
```

---

### 📄 Archivo 4: `controllers/pdfReports.controller.js`


```javascript
/*
COPILOT: Genera controlador para endpoints de generación de PDFs

REQUISITOS:
- Importar BulkPDFGenerator de '../services/bulkPDFGenerator'
- Importar { getHTMLTemplate, generateHTMLFromReport } de '../utils/htmlTemplateGenerator'
- Importar Report model (asume que existe en '../models/Report')

CONTROLADOR 1: generateBulkPDFs
- async function (req, res)
- Extraer { reportIds, filters } de req.body
- Si reportIds existe y tiene elementos: await Report.find({ _id: { $in: reportIds } })
- Sino si filters existe: await Report.find(filters)
- Sino: retornar status 400, json { success: false, message: 'Debes proporcionar reportIds o filters' }
- Si no hay reports: retornar 404, json { success: false, message: 'No se encontraron reportes' }
- Loguear "Solicitud para generar X PDFs"
- Crear instancia de BulkPDFGenerator
- Obtener template con getHTMLTemplate()
- Llamar generator.generateBulkPDFs(reports, (report) => generateHTMLFromReport(report, template))
- Generar fileName: "reportes_{fecha-iso}_{timestamp}.zip"
- Configurar headers: Content-Type application/zip, Content-Disposition attachment, Content-Length
- Enviar zipBuffer con res.send()
- En catch: loguear error, retornar status 500 con json de error

CONTROLADOR 2: generateSinglePDF
- async function (req, res)
- Extraer reportId de req.body o req.params
- Validar que existe
- await Report.findById(reportId)
- Si no existe: retornar 404
- Importar PDFMicroserviceClient
- Crear instancia de cliente
- Generar HTML con generateHTMLFromReport
- Llamar client.generatePDF(html)
- Configurar headers de PDF
- Enviar pdfBuffer
- En catch: status 500 con json de error

CONTROLADOR 3: checkMicroserviceHealth
- async function (req, res)
- Importar PDFMicroserviceClient
- Crear instancia
- Llamar client.healthCheck()
- Retornar json { success: true, microservice: { status: 'online' o 'offline', url: process.env.PDF_SERVICE_URL } }
- En catch: status 500

- Exportar { generateBulkPDFs, generateSinglePDF, checkMicroserviceHealth }
*/
```

---

### 📄 Archivo 5: `routes/pdfReports.routes.js`


```javascript
/*
COPILOT: Genera rutas para los endpoints de PDF

REQUISITOS:
- Importar express y crear Router()
- Importar { generateBulkPDFs, generateSinglePDF, checkMicroserviceHealth } de '../controllers/pdfReports.controller'

RUTAS:
- POST '/bulk' -> generateBulkPDFs
- POST '/single' -> generateSinglePDF  
- GET '/health' -> checkMicroserviceHealth

MIDDLEWARE OPCIONAL (si tienes auth):
// const { authenticate } = require('../middleware/auth');
// router.use(authenticate);

- Exportar router

COMENTARIOS:
// POST /api/pdf-reports/bulk - Genera múltiples PDFs y descarga ZIP
// Body: { reportIds: [...] } o { filters: {...} }

// POST /api/pdf-reports/single - Genera un PDF individual
// Body: { reportId: "..." }

// GET /api/pdf-reports/health - Verifica estado del microservicio
*/
```

---

### 📄 Archivo 6: Integrar en `app.js` o `server.js`


```javascript
/*
COPILOT: Agrega estas líneas después de tus rutas existentes

CÓDIGO:
const pdfReportsRoutes = require('./routes/pdfReports.routes');
app.use('/api/pdf-reports', pdfReportsRoutes);
*/
```

---



## 🧪 PASO 5: TESTING

### Test Manual con CURL:

```bash
# 1. Verificar microservicio
curl http://localhost:3000/health

# 2. Verificar health desde backend
curl http://localhost:TU_PUERTO/api/pdf-reports/health

# 3. Generar PDFs por IDs
curl -X POST http://localhost:TU_PUERTO/api/pdf-reports/bulk \
  -H "Content-Type: application/json" \
  -d '{"reportIds": ["ID1", "ID2", "ID3"]}' \
  --output reportes.zip

# 4. Generar PDFs con filtros
curl -X POST http://localhost:TU_PUERTO/api/pdf-reports/bulk \
  -H "Content-Type: application/json" \
  -d '{"filters": {"estado": "Completado"}}' \
  --output reportes.zip

# 5. Generar PDF individual
curl -X POST http://localhost:TU_PUERTO/api/pdf-reports/single \
  -H "Content-Type: application/json" \
  -d '{"reportId": "ID"}' \
  --output reporte.pdf
```



## 📊 PASO 5: LOGS Y MONITOREO

El sistema genera logs automáticos:

```
🚀 Iniciando generación de 5 PDFs...
📄 Procesando 1/5 - Reporte: RPT-2024-001
   ✅ PDF generado: RPT-2024-001_1234567890.pdf
📄 Procesando 2/5 - Reporte: RPT-2024-002
   ✅ PDF generado: RPT-2024-002_1234567891.pdf
...
📦 Generando archivo ZIP...

═══════════════════════════════════════════
          RESUMEN DE GENERACIÓN
═══════════════════════════════════════════
✅ Exitosos:        4
❌ Fallidos:        1
📦 Tamaño del ZIP:  2.45 MB

⚠️  Errores encontrados:
   1. RPT-2024-005: Timeout al generar PDF
═══════════════════════════════════════════
```

---

## 🔧 PASO 6: TROUBLESHOOTING

### Error: "Microservicio PDF no responde"
```javascript
// Verificar que el microservicio esté corriendo:
// curl http://localhost:3000/health

// Verificar la URL en .env:
// PDF_SERVICE_URL=http://localhost:3000/api/pdf
```

### Error: "Cannot find module 'jszip'"
```bash
npm install jszip
```

### Error: "Report is not defined"
```javascript
// Verificar que el import del modelo sea correcto:
// const Report = require('./models/Report'); // Ajustar ruta
```

### PDFs vacíos o con errores
```javascript
// Verificar que el HTML template tenga todos los placeholders
// Verificar que los datos del report tengan la estructura correcta
// console.log(report) antes de generar el HTML
```

---

## 🚀 PASO 7: OPTIMIZACIONES OPCIONALES

### Para procesar muchos reportes (>100):

**COPIAR EN `services/bulkPDFGenerator.js` (al final):**

```javascript
/*
COPILOT: Agrega método para procesamiento paralelo

REQUISITOS:
- Método async generateBulkPDFsParallel(reports, htmlGenerator, concurrency = 3)
- Dividir reports en chunks de tamaño concurrency
- Para cada chunk:
  * Crear array de promesas llamando this.generateSinglePDF(report, htmlGenerator)
  * Hacer Promise.all() del array
- Método async generateSinglePDF(report, htmlGenerator) que:
  * Genere HTML
  * Llame this.pdfClient.generatePDF()
  * Retorne { fileName, buffer, reportId }
- Al final, agregar todos los PDFs al ZIP y retornar
*/
```

---

## 📝 ESTRUCTURA FINAL DEL PROYECTO

```
tu-backend/
├── .env                           ← Agregar PDF_SERVICE_URL
├── models/
│   └── Report.js                  ← Modelo de datos
├── services/
│   ├── pdfMicroserviceClient.js   ← Cliente del microservicio
│   └── bulkPDFGenerator.js        ← Generador masivo
├── utils/
│   └── htmlTemplateGenerator.js   ← Templates HTML
├── controllers/
│   └── pdfReports.controller.js   ← Lógica de negocio
├── routes/
│   └── pdfReports.routes.js       ← Definición de rutas
└── app.js                         ← Integrar rutas aquí
```

---

## ✅ CHECKLIST FINAL

- [ ] Instalé `jszip`
- [ ] Agregué `PDF_SERVICE_URL` al `.env`
- [ ] Creé todos los archivos con los prompts de Copilot
- [ ] Integré las rutas en `app.js`
- [ ] Verifiqué que el microservicio esté corriendo
- [ ] Probé el health check
- [ ] Generé PDFs de prueba
- [ ] Los PDFs se descargaron correctamente en ZIP

---

## 💡 TIPS PARA USAR CON COPILOT

1. **Copia el prompt completo** en un archivo vacío
2. **Presiona Enter** después del comentario
3. **Copilot generará el código** automáticamente
4. **Presiona Tab** para aceptar sugerencias
5. **Revisa el código** generado antes de continuar

---

## 📞 SOPORTE

Si algo no funciona:
1. Verifica los logs de consola
2. Verifica que el microservicio esté corriendo
3. Verifica las rutas y nombres de archivos
4. Revisa la estructura de datos en MongoDB

---

**¡Listo! Copilot se encargará de todo el código.** 🚀