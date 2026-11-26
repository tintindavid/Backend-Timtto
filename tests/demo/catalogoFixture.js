export const catalogoFixture = () => ({
  actividades: [
    { key: 'a1', Nombre: 'Limpieza general', Descripcion: 'Limpieza externa', EsObligatoria: 'true', StatusReason: '' },
    { key: 'a2', Nombre: 'Inspección eléctrica', Descripcion: '', EsObligatoria: 'false', StatusReason: '' },
  ],
  protocolos: [
    { key: 'p1', nombre: 'Protocolo básico', Descripcion: 'Base', actividadKeys: ['a1', 'a2'] },
    { key: 'p2', nombre: 'Vacío', Descripcion: '', actividadKeys: [] },
  ],
  items: [
    { key: 'i1', Nombre: 'Monitor de signos', Observacion: '', protocoloKey: 'p1' },
    { key: 'i2', Nombre: 'Sin protocolo', Observacion: '', protocoloKey: null },
    { key: 'i3', Nombre: 'Protocolo vacío', Observacion: '', protocoloKey: 'p2' },
  ],
  protocoloActividades: [{ protocoloKey: 'p1', actividadKey: 'a1' }],
});
