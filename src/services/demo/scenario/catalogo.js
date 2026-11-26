import { Items } from '../../../models/items.model.js';
import { ActividadMtto } from '../../../models/actividadmtto.model.js';
import { ProtocoloMtto } from '../../../models/protocolomtto.model.js';
import { ProtocoloActividad } from '../../../models/protocoloactividad.model.js';

/** The tenant's OWN copy of the base catalogue. */
export function buildCatalogo(ctx) {
  const { tenantId, catalog, id } = ctx;
  const actividadId = (key) => id(`actividad:${key}`);
  const protocoloId = (key) => id(`protocolo:${key}`);

  const actividades = catalog.actividades.map(({ key, ...data }) => ({ _id: actividadId(key), tenantId, ...data }));
  const protocolos = catalog.protocolos.map((p) => ({
    _id: protocoloId(p.key),
    tenantId,
    nombre: p.nombre,
    Descripcion: p.Descripcion,
    actividadesMtto: p.actividadKeys.map(actividadId),
  }));
  const items = catalog.items.map((i) => ({
    _id: id(`item:${i.key}`),
    tenantId,
    Nombre: i.Nombre,
    Observacion: i.Observacion,
    ...(i.protocoloKey ? { ProtocoloId: String(protocoloId(i.protocoloKey)) } : {}),
  }));
  const links = (catalog.protocoloActividades ?? []).map((l) => ({
    _id: id(`protocolo-actividad:${l.protocoloKey}:${l.actividadKey}`),
    tenantId,
    ProtocoloId: protocoloId(l.protocoloKey),
    ActividadId: actividadId(l.actividadKey),
  }));

  const activityByKey = new Map(catalog.actividades.map((a) => [a.key, { ...a, _id: actividadId(a.key) }]));
  ctx.refs.activitiesOfItem = (itemKey) => {
    const item = catalog.items.find((i) => i.key === itemKey);
    const protocol = catalog.protocolos.find((p) => p.key === item?.protocoloKey);
    return (protocol?.actividadKeys ?? []).map((k) => activityByKey.get(k));
  };

  return [
    { Model: ActividadMtto, docs: actividades },
    { Model: ProtocoloMtto, docs: protocolos },
    { Model: Items, docs: items },
    { Model: ProtocoloActividad, docs: links },
  ];
}
