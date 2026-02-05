# Integración Firebase Storage para Logos de Clientes

## 📋 Descripción
Se ha integrado Firebase Storage como bucket de almacenamiento para los logos de clientes. Al crear o editar un customer, el logo se sube automáticamente a Firebase y solo se almacena la URL en la base de datos.

## 🎯 Archivos Creados/Modificados

### Nuevos Archivos:
- `src/config/firebase.config.js` - Configuración de Firebase Admin SDK
- `src/services/external/firebase.service.js` - Servicio para gestión de archivos en Firebase Storage
- `src/middlewares/upload.middleware.js` - Middleware multer para manejo de archivos multipart

### Archivos Modificados:
- `src/services/customer.service.js` - Integración con Firebase Storage
- `src/controllers/customer.controller.js` - Manejo de archivos en requests
- `src/routes/customer.routes.js` - Middleware de upload en rutas
- `src/server.js` - Inicialización de Firebase al arrancar servidor
- `.env.example` - Variables de entorno para Firebase

## 🔐 Configuración de Firebase

### 1. Obtener Credenciales
1. Ir a [Firebase Console](https://console.firebase.google.com/)
2. Seleccionar proyecto "biolab-storage"
3. Ir a **Project Settings** > **Service Accounts**
4. Click en **Generate New Private Key**
5. Descargar el archivo JSON

### 2. Configurar Variables de Entorno
Agregar al archivo `.env`:

```env
FIREBASE_PRIVATE_KEY_ID=xxxxx
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nxxxxx\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@biolab-storage.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=xxxxx
FIREBASE_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/xxxxx
```

**Nota:** El `FIREBASE_PRIVATE_KEY` debe incluir los saltos de línea como `\n`

## 📡 Uso en el Frontend

### Crear Customer con Logo

```javascript
const formData = new FormData();
formData.append('Razonsocial', 'Empresa XYZ');
formData.append('Ciudad', 'Bogotá');
formData.append('Departamento', 'Cundinamarca');
formData.append('Email', 'info@empresa.com');
formData.append('Nit', '123456789');
formData.append('logo', logoFile); // El archivo de imagen

const response = await fetch('/api/v1/customers', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Actualizar Customer con Nuevo Logo

```javascript
const formData = new FormData();
formData.append('Razonsocial', 'Empresa XYZ Actualizada');
formData.append('logo', newLogoFile); // El nuevo logo (opcional)

const response = await fetch(`/api/v1/customers/${customerId}`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

## ⚙️ Características Implementadas

### Validaciones:
- ✅ Solo acepta imágenes (jpeg, jpg, png, gif, webp)
- ✅ Tamaño máximo: 5MB
- ✅ Nombres de archivo únicos (UUID)
- ✅ Archivos públicos automáticamente

### Funcionalidades:
- ✅ Subida de logos al crear customer
- ✅ Reemplazo de logos al actualizar customer
- ✅ Eliminación de logos al borrar customer (soft delete)
- ✅ Almacenamiento organizado en carpeta `logos/`
- ✅ URLs públicas directas
- ✅ Logging de todas las operaciones

### Seguridad:
- ✅ Validación de tipo MIME
- ✅ Límite de tamaño de archivo
- ✅ Autenticación requerida
- ✅ Tenant isolation

## 🧪 Testing

### Probar Subida de Logo:
```bash
curl -X POST http://localhost:3000/api/v1/customers \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "Razonsocial=Test Company" \
  -F "Ciudad=Bogotá" \
  -F "Departamento=Cundinamarca" \
  -F "Email=test@test.com" \
  -F "Nit=123456789" \
  -F "logo=@/path/to/logo.png"
```

### Probar Actualización con Logo:
```bash
curl -X PUT http://localhost:3000/api/v1/customers/CUSTOMER_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "Razonsocial=Updated Company" \
  -F "logo=@/path/to/new-logo.png"
```

## 🔧 Estructura de URLs Generadas

Las URLs de los logos siguen este formato:
```
https://storage.googleapis.com/biolab-storage.appspot.com/logos/{uuid}.{extension}
```

Ejemplo:
```
https://storage.googleapis.com/biolab-storage.appspot.com/logos/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png
```

## 📝 Notas Importantes

1. **Sin Credenciales:** Si no se configuran las credenciales de Firebase, el servidor arrancará pero las funciones de subida de archivos no estarán disponibles.

2. **Logo Opcional:** El logo es opcional tanto en creación como en actualización. Si no se proporciona, el campo `Logo` quedará vacío.

3. **Limpieza Automática:** Al eliminar un customer (soft delete), su logo se elimina automáticamente de Firebase Storage.

4. **Reemplazo Automático:** Al actualizar un customer con un nuevo logo, el logo anterior se elimina automáticamente.

## 🐛 Troubleshooting

### Error: "Firebase no ha sido inicializado"
- Verificar que las credenciales estén configuradas en `.env`
- Revisar los logs del servidor al arrancar
- Verificar formato del `FIREBASE_PRIVATE_KEY` (debe incluir `\n`)

### Error: "Tipo de archivo no permitido"
- Solo se aceptan imágenes: jpeg, jpg, png, gif, webp
- Verificar que el archivo sea realmente una imagen

### Error: "El archivo es demasiado grande"
- Tamaño máximo: 5MB
- Comprimir la imagen antes de subirla

## 📦 Dependencias Instaladas

```json
{
  "firebase-admin": "^12.x.x",
  "multer": "^1.4.x",
  "uuid": "^9.x.x"
}
```

## 🚀 Próximos Pasos

- [ ] Agregar resize automático de imágenes
- [ ] Implementar caché de URLs
- [ ] Agregar soporte para múltiples logos
- [ ] Implementar CDN para mejor performance
