# 📱 API HVEquipo - Guía para Frontend

## 🔐 Autenticación
Todas las rutas requieren header:
```http
Authorization: Bearer {token}
```

---

## 📡 Endpoints Disponibles

### 1. Crear HVEquipo
```http
POST /api/v1/hv-equipo
Content-Type: application/json

{
  "clienteId": "507f1f77bcf86cd799439011",
  "EquipoId": "507f1f77bcf86cd799439012",
  "equipoSnapshot": {
    "ItemText": "Monitor de Signos Vitales",
    "Marca": "Philips",
    "Modelo": "IntelliVue MP70",
    "Serie": "DE12345678",
    "Inventario": "INV-2024-001",
    "Servicio": "UCI",
    "Ubicacion": "Piso 3 - Sala 301"
  },
  "Accesorios": [
    {
      "nombre": "Cable ECG 5 derivaciones",
      "descripcion": "Cable troncal para electrocardiograma",
      "cantidad": 2,
      "estado": "Nuevo",
      "observaciones": "Incluido en compra original"
    }
  ],
  "TecnologiaPredominante": "Electrónica digital",
  "EstadoHV": "Guardada",
  "Fabricante": "Philips Healthcare",
  "FechaAdquisicin": "2024-01-15T00:00:00.000Z",
  "FechaInstalacion": "2024-02-01T00:00:00.000Z",
  "ValorAdquisicion": 25000000,
  "TipoAdquisicion": "Compra",
  "UsoEquipo": "Produccion",
  "RequiereCalibracion": true,
  "PeriodicidadCalibracion": "Anual",
  "PeriodicidadMantenimiento": "Trimestral",
  "RegistroINVIMA": "2023DM-0012345",
  "Voltaje": "110-220V AC",
  "Frecuencia": "50/60 Hz",
  "Potencia": "100W",
  "Corriente": "1.5A",
  "Peso": 5.5,
  "FuenteAlimentacion": "AC/DC con batería respaldo",
  "AutonomiaBatería": "4 horas",
  "TemperaturaOperacion": "15°C - 35°C",
  "HumedadOperacion": "30% - 85% RH",
  "ClasificacinRiesgo": "IIB",
  "TipoEquipo": "Monitoreo",
  "Recomendaciones": [
    "Calibrar sensores cada 6 meses",
    "Mantener limpio el equipo",
    "Verificar batería mensualmente"
  ],
  "ManualDisponible": true,
  "PlanoDisponible": false,
  "RequiereCapacitacion": true
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "HVEquipo creado exitosamente",
  "data": { ...HVEquipo }
}
```

---

### 2. Listar HVEquipos (con filtros)
```http
GET /api/v1/hv-equipo?page=1&limit=10&EstadoHV=Aprobada&clienteId=507f1f77bcf86cd799439011
```

**Query params opcionales:**
- `page` (default: 1)
- `limit` (default: 10, max: 100)
- `sortBy` (default: createdAt)
- `order` (asc|desc, default: desc)
- `search` - Busca en ItemText, Marca, Modelo, Fabricante, TipoEquipo, RegistroINVIMA
- `EstadoHV` - Guardada|Aprobada
- `TipoEquipo` - Filtrar por tipo
- `UsoEquipo` - Apoyo|Soporte|Produccion|Investigacion|Docencia
- `clienteId` - Filtrar por cliente específico

**Response 200:**
```json
{
  "success": true,
  "message": "HVEquipos recuperados exitosamente",
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### 3. 🆕 Listar HVEquipos Aprobadas por Marca y Modelo
```http
GET /api/v1/hv-equipo/aprobadas/:marca/:modelo?page=1&limit=10
```

**Ejemplo:**
```http
GET /api/v1/hv-equipo/aprobadas/Philips/IntelliVue%20MP70?page=1&limit=5
```

**Params requeridos:**
- `:marca` - Marca del equipo (ej: "Philips", "GE", "Siemens")
- `:modelo` - Modelo del equipo (ej: "IntelliVue MP70", "Datex S5")

**Query params opcionales:**
- `page`, `limit`, `sortBy`, `order`

**Caso de uso:**  
Cuando el usuario selecciona un equipo nuevo y quiere usar una HV ya aprobada como plantilla/referencia para equipos de la misma marca/modelo.

**Response 200:**
```json
{
  "success": true,
  "message": "HVEquipos aprobadas para Philips IntelliVue MP70 recuperadas exitosamente",
  "data": [...],
  "pagination": {...}
}
```

---

### 4. Obtener HVEquipo por ID
```http
GET /api/v1/hv-equipo/507f1f77bcf86cd799439099
```

**Response 200:**
```json
{
  "success": true,
  "message": "HVEquipo recuperado exitosamente",
  "data": {
    "_id": "507f1f77bcf86cd799439099",
    "clienteId": {...},
    "EquipoId": {...},
    "userIdCreacion": {...}
  }
}
```

---

### 5. 🆕 Obtener HVEquipo por EquipoId
```http
GET /api/v1/hv-equipo/equipo/:equipoId
```

**Ejemplo:**
```http
GET /api/v1/hv-equipo/equipo/697eab78ee832f13fb38fc14
```

**Params requeridos:**
- `:equipoId` - ID del equipo del cual obtener su HV

**Caso de uso:**  
Obtener la Hoja de Vida (HV) más reciente asociada a un equipo específico. Si existe más de una HV, devuelve la más reciente.

**Response 200:**
```json
{
  "success": true,
  "message": "HVEquipo recuperado exitosamente",
  "data": {
    "_id": "507f1f77bcf86cd799439099",
    "EquipoId": {
      "_id": "697eab78ee832f13fb38fc14",
      "ItemText": "Monitor de Signos Vitales",
      "Marca": "Philips",
      "Modelo": "IntelliVue MP70",
      "Serie": "DE12345678"
    },
    "EstadoHV": "Aprobada",
    "clienteId": {
      "_id": "...",
      "Razonsocial": "Hospital ABC",
      "Nit": "900123456-7",
      "Ciudad": "Bogotá"
    },
    "userIdCreacion": {
      "_id": "...",
      "firstName": "Juan",
      "lastName": "Pérez",
      "email": "juan@example.com"
    },
    "Fabricante": "Philips Healthcare",
    "TipoEquipo": "Monitoreo",
    "ValorAdquisicion": 25000000,
    "FechaAdquisicin": "2024-01-15T00:00:00.000Z",
    "createdAt": "2024-02-01T00:00:00.000Z",
    "updatedAt": "2024-02-01T00:00:00.000Z"
  }
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "HVEquipo no encontrado para este equipo",
  "error": {
    "code": "NOT_FOUND",
    "details": { "equipoId": "697eab78ee832f13fb38fc14" }
  }
}
```

**Nota:** Retorna solo la HV más reciente (ordenada por `createdAt` descendente).

---

### 6. Actualizar HVEquipo
```http
PUT /api/v1/hv-equipo/507f1f77bcf86cd799439099
Content-Type: application/json

{
  "EstadoHV": "Aprobada",
  "UserApruebacion": "Carlos Rodríguez - Especialista Biomédico",
  "CargoUserAprobacion": "Coordinador Técnico",
  "Observaciones": "HV aprobada tras revisión técnica"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "HVEquipo actualizado exitosamente",
  "data": {...}
}
```

---

### 7. Eliminar HVEquipo (soft delete)
```http
DELETE /api/v1/hv-equipo/507f1f77bcf86cd799439099
```

**Response 200:**
```json
{
  "success": true,
  "message": "HVEquipo eliminado exitosamente",
  "data": null
}
```

---

## 📋 Campos Clave

### EstadoHV
- `Guardada` - HV en borrador (default)
- `Aprobada` - HV validada y lista como referencia

### TipoAdquisicion
- `Compra` | `Leasing` | `Donación` | `Alquiler`

### UsoEquipo
- `Apoyo` | `Soporte` | `Produccion` | `Investigacion` | `Docencia`

### ClasificacinRiesgo
- `I` | `IIA` | `IIB` | `III`

### Campos Booleanos
- `RequiereCalibracion` - Si el equipo requiere calibración periódica
- `ManualDisponible` - Si se tiene el manual del equipo
- `PlanoDisponible` - Si se tienen planos técnicos del equipo
- `RequiereCapacitacion` - Si el equipo requiere capacitación para su uso

### Arrays
- `Recomendaciones` - String o Array de strings con recomendaciones de mantenimiento (se convertirá automáticamente a array)
- `Accesorios` - Array de objetos con accesorios del equipo
- `equipoSnapshot.MesesMtto` - Array de strings con meses de mantenimiento

**Nota:** `Recomendaciones` acepta ambos formatos:
```json
"Recomendaciones": "Una sola recomendación"
// O
"Recomendaciones": ["Recomendación 1", "Recomendación 2"]
```
Ambos se guardarán como array en la base de datos.

---

## ⚠️ Errores Comunes

**400 - Validación fallida**
```json
{
  "success": false,
  "message": "Datos de entrada inválidos",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {"clienteId": "clienteId es requerido"}
  }
}
```

**401 - No autorizado**
```json
{
  "success": false,
  "message": "Token de autenticación inválido"
}
```

**404 - No encontrado**
```json
{
  "success": false,
  "message": "HVEquipo no encontrado"
}
```

---

## 💡 Notas

1. **Reutilización:** Usar `/aprobadas/:marca/:modelo` para cargar HVs de referencia al crear equipos nuevos.

2. **Populate automático:** Los endpoints populan `EquipoId`, `clienteId`, `userIdCreacion`.

3. **Fechas:** Enviar en formato ISO 8601 (ej: `2024-01-15T00:00:00.000Z`).

4. **Search:** Busca en ItemText, Marca, Modelo, Fabricante, TipoEquipo, RegistroINVIMA.
