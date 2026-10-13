// First five values are legacy and must stay valid for HVs already saved.
export const USO_EQUIPO_VALUES = [
  'Apoyo',
  'Soporte',
  'Produccion',
  'Investigacion',
  'Docencia',
  'Diagnóstico',
  'Monitoreo y soporte vital',
  'Terapéutico y rehabilitación',
  'Laboratorio clínico',
  'Anestesia y quirófano',
  'Imágenes diagnósticas',
];

// Whole months, 1-999 (no leading zeros). Empty string clears the field.
export const PERIODICIDAD_MESES_PATTERN = /^(?:[1-9]\d{0,2})?$/;

// Documentos[] category: 'guia_rapida' items live in the GR tab, the rest in "Documentos".
export const CATEGORIAS_DOCUMENTO = ['general', 'guia_rapida'];
