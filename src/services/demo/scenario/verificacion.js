/**
 * Parameter verification history of the two featured pieces of equipment (0: patient monitor, 1: infusion pump). It tells
 * a story the trend chart can show: stable readings, a slow drift into warning, out of tolerance, and back to normal
 * after the adjustment.
 */

// Deviation (%) of each visit, oldest first.
const DRIFT = [0.3, -0.5, 0.8, 1.4, 2.6, 3.7, 6.2, 0.4];

// Per equipment: magnitude, unit, standard used and its reference points as [value, drift scale] (negative reads low).
const FEATURED = [
  [
    { magnitud: 'Frecuencia cardíaca', unidad: 'lpm', patron: 'Simulador de paciente (ejemplo)', puntos: [[60, 0.5], [120, 1]] },
    { magnitud: 'Saturación SpO2', unidad: '%', patron: 'Simulador de SpO2 (ejemplo)', puntos: [[85, -1], [97, -0.45]] },
    { magnitud: 'Presión no invasiva', unidad: 'mmHg', patron: 'Simulador de presión (ejemplo)', puntos: [[80, -0.55], [120, 0.85]] },
  ],
  [
    { magnitud: 'Flujo', unidad: 'mL/h', patron: 'Analizador de infusión (ejemplo)', puntos: [[25, -1], [100, -0.6]] },
    { magnitud: 'Presión de oclusión', unidad: 'mmHg', patron: 'Analizador de infusión (ejemplo)', puntos: [[300, 0.8]] },
  ],
];

export const isFeatured = (equipoIndex) => equipoIndex < FEATURED.length;

/** Measurements of one visit (`visit` counts from 0, oldest first). */
export function buildVerification(equipoIndex, visit, idFor) {
  const drift = DRIFT[visit % DRIFT.length];
  return FEATURED[equipoIndex]
    .flatMap(({ magnitud, unidad, patron, puntos }) => puntos.map(([valorReferencia, scale]) => ({
      magnitud,
      unidad,
      patron,
      valorReferencia,
      valorMedido: Number((valorReferencia * (1 + (drift * scale) / 100)).toFixed(1)),
    })))
    .map((row, n) => ({ _id: idFor(n), ...row }));
}

/** Tolerances shown by the trend chart of the equipment record. */
export function buildTolerances(equipoIndex, idFor) {
  return FEATURED[equipoIndex].map(({ magnitud, unidad }, n) => ({
    _id: idFor(n), magnitud, unidad, umbralAlertaPct: 2, umbralFueraToleranciaPct: 5,
  }));
}
