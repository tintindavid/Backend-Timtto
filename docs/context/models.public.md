**Public Models Reference**

Nota: se listan solo los campos públicos (excluyendo `isDeleted`, `deletedAt`, `__v` y hashes/secretos). Para detalles completos consulte el archivo de modelo en `src/models`.

- User (`User` - collection `users`)
  - `tenantId`: string
  - `firstName`: string
  - `lastName`: string
  - `fullName`: string
  - `username`: string
  - `email`: string
  - `role`: string (`admin`|`technician`|`user`)
  - `phone`, `city`, `registroInvima`, `photo`

- Tenant (`Tenant` - collection `tenants`)
  - `tenantId`: string (clave pública del tenant)
  - `name`: string
  - `status`: string (`active`|`suspended`|`closed`)
  - `plan`: string
  - `ownerId`, `contact` (obj con `email`, `phone`), `settings` (mixed)

- Customer (`Customer` - collection `customers`)
  - `CustomerPK`, `Razonsocial`, `Ciudad`, `Departamento`, `Email`, `Nit`, `Status`, `Address`, `Direccion`, `Logo`, `TelContacto`, `UserContacto`

- Address (`Address` - collection `addresss`)
  - `tenantId`, `addressId` (string)

- OT (`OT` - collection `ots`)
  - `OTPK`, `Consecutivo`, `ClienteId`, `EstadoOt`, `FechaCreacion`, `Norden`, `Status`, `TipoServicio`, `Avance`, `EstadoText`, `numeroOt`, `OtPrioridad`, `ResponsableId`, `StatusReason`

- Items (`Items` - collection `itemss`)
  - `ItemsPK`, `ItemId`, `Nombre`, `Status`, `Observacion`, `ProtocoloId`, `StatusReason`

- Report (`Report` - collection `reports`)
  - `ReportPK`, `ID`, `Status`, `AccesoriosDelEquipo`, `CausaEncontrada`, `ClienteId`, `consecutivo`, `duracion`, `Equipo`, `estado`, `FechaCreacion`, `fechaFinalizdo`, `fechaProcesado`, `hojaDeTrabajo`, `Marca`, `Modelo`, `Observacion`, `ResponsableId`, `Sede`, `Servicio`, `StatusReason`, `tipoMtto`, `Ubicacion`

- Sedes (`Sedes` - collection `sedess`)
  - `SedesPK`, `Sede_id`, `Cliente`, `contact`, `departamento`, `nombreSede`, `Status`, `telefono`, `ciudad`, `direccion`, `StatusReason`

- SheetWork (`SheetWork` - collection `sheet-works`)
  - `SheetWorkPK`, `sheeWork`, `otId`, `Status`, `cargoRecibe`, `firmaFile`, `firmaResponsable`, `numeroHoja`, `PdfGenerado`, `PdfHojaTrabajo`, `personaRecibe`, `responsable`, `StatusReason`

- Servicios (`Servicios` - collection `servicioss`)
  - `UbicacionPK`, `ServicioId`, `Cliente`, `nombre`, `Status`, `observacion`, `StatusReason`

- Repuestos (`Repuestos` - collection `repuestoss`)
  - `RepuestosPK`, `repuesto_id`, `Cantidad`, `nombre`, `Status`, `CantidadInstalacion`, `Currency`, `EquipoId`, `EstadoSolicitud`, `FechaInstalacion`, `FechaSolicitud`, `PrecioRepuesto`, `Prioridad`, `StatusReason`

- RepuestoTrazabilidad (`RepuestoTrazabilidad` - collection `repuesto-trazabilidads`)
  - `Repuesto_TrazabilidadPK`, `Repuesto_Trazabilidad`, `Status`, `Attachments`, `Cantidad`, `Comentarios`, `EstadoActual`, `EstadoAnterior`, `FechaHoraCambio`, `SolicitudRepuestoId`, `StatusReason`

- HVEquipo (`HVEquipo` - collection `hvequipos`)
  - `HVEquipoPK`, `NombreEquipo`, `Estado`, `Accesorios`, `Marca`, `Modelo`, `NmeroSerie`, `FechaAdquisicin`, `FechaInstalacin`, `Periodo`..., `StatusReason` (numerosos campos de equipo)

- EquipoItem (`EquipoItem` - collection `equipo-items`)
  - `EquitmentPK`, `Equipment`, `ClienteId`, `Estado`, `ItemId`, `Marca`, `SedeId`, `Serie`, `Servicio`, `Status`, `Area`, `Modelo`, `UltimoMtto`, `UltimoConsecutivoMtto`, `StatusReason`

- ProtocoloMtto (`ProtocoloMtto` - collection `protocolo-mttos`)
  - `ProtocoloMttoPK`, `ProtocoloId`, `Status`, `Descripcion`, `nombre`, `StatusReason`

- ProtocoloActividad (`ProtocoloActividad` - collection `protocolo-actividads`)
  - `ProtocoloActividadPK`, `Id`, `Status`, `ActividadId`, `ProtocoloId`, `StatusReason`

- ActividadMtto (`ActividadMtto` - collection `actividad-mttos`)
  - `ActividadMttoPK`, `ActividadId`, `Status`, `Descripcion`, `EsObligatoria`, `Nombre`, `StatusReason`

- ActividadReporte (`ActividadReporte` - collection `actividad-reportes`)
  - `ActividadReportePK`, `Actividadreport`, `ActividadId`, `Status`, `observacion`, `Realizado`, `reportId`, `StatusReason`

- Informe (`Informe` - collection `informes`)
  - `InformePK`, `Nombre`, `Estadministrado`, `Estadodelcomponente`, `Esuninformepersonalizado`, `Esuninformeprogramado`, `Horadesobrescrituradelregistro`, `Idioma`, `FileContent`, `Nombredearchivo`, `TipoMIME`, `URLdeinformevinculado`, `Versindelinforme` (varios campos relacionados al informe)

- Usuario (`Usuario` - collection `usuarios`)
  - conjunto amplio de campos de usuario/identidad (ver `src/models/usuario.model.js` para la lista completa).

Relaciones
- La mayoría de relaciones entre entidades se representan mediante campos ID (p. ej. `ClienteId`, `SedeId`, `EquipoId`, `ProtocoloId`, `otId`, `ResponsableId`). No existen `populate` explícitos en los modelos — el frontend debe consumir IDs y solicitar endpoints relacionados cuando necesite datos referenciados.

Nota final
- Para cada modelo, el frontend debe revisar el archivo fuente en `src/models/{name}.model.js` para confirmar tipos y campos disponibles. Aquí se listan los campos principales expuestos.
