import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const InformeSchema = new Schema({
  tenantId: { type: String, required: true },
    Nombre: { type: String, required: true, trim: true },
    Estadministrado: { type: Boolean, required: true, trim: true },
    Estadodelcomponente: { type: String, required: true, trim: true },
    Esuninformepersonalizado: { type: Boolean, required: true, trim: true },
    Esuninformeprogramado: { type: Boolean, required: true, trim: true },
    Horadesobrescrituradelregistro: { type: Date, required: true, trim: true },
    Idioma: { type: Number, required: true, trim: true },
    Informe_: { type: String, required: true, trim: true },
    Personalizable: { type: String, required: true, trim: true },
    Solucin: { type: String, required: true, trim: true },
    Tipodeinforme: { type: String, required: true, trim: true },
    Visiblepor: { type: Boolean, required: true, trim: true },
    ApplicationId: { type: String,  trim: true },
    cdsdatasetid: { type: String,  trim: true },
    Cdigodeidiomadefirma: { type: Number,  trim: true },
    Cuerpobinario: { type: String,  trim: true },
    DependentModelReportId: { type: String,  trim: true },
    Descripcin: { type: String,  trim: true },
    Estadodelinforme: { type: String,  trim: true },
    Estructuradeinformacindeconsulta: { type: String,  trim: true },
    Fechadefirmadeinforme: { type: Date,  trim: true },
    FileContent: { type: String,  trim: true },
    Filtropredeterminado: { type: String,  trim: true },
    Firma: { type: String,  trim: true },
    Hashdeltextodelcuerpo: { type: Number,  trim: true },
    InformacindelreadetrabajodePowerBI: { type: String,  trim: true },
    Informeprimario: { type: String,  trim: true },
    InformeXMLpersonalizado: { type: String,  trim: true },
    ManagedType: { type: String,  trim: true },
    Nombredearchivo: { type: String,  trim: true },
    NombredelinformedePowerBI: { type: String,  trim: true },
    NombreenSRS: { type: String,  trim: true },
    PowerBIDatasetId: { type: String,  trim: true },
    powerbifeaturetag: { type: String,  trim: true },
    PowerBiReportId: { type: String,  trim: true },
    powerbireportinternalstate: { type: String,  trim: true },
    Solucin: { type: String,  trim: true },
    Tamaodearchivobytes: { type: Number,  trim: true },
    Textodecuerpo: { type: String,  trim: true },
    Textodecuerpo: { type: String,  trim: true },
    TipoMIME: { type: String,  trim: true },
    URLdeinformevinculado: { type: String,  trim: true },
    Versindelinforme: { type: Number,  trim: true },
    Versinintroducida: { type: String,  trim: true },
    Versinprincipaldefirmadeinforme: { type: Number,  trim: true },
    Versinsecundariadefirmadeinforme: { type: Number,  trim: true },
    XMLdedefinicindeprogramacin: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'informes'
});

// Indexes (tenant-aware)
InformeSchema.index({ tenantId: 1, isDeleted: 1 });
InformeSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
InformeSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
InformeSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Informe = model('Informe', InformeSchema);
