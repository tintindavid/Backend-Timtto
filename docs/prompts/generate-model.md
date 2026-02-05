# Generate Mongoose Model

Genera un modelo Mongoose completo siguiendo estas instrucciones:

## Input Requerido
- Nombre de la entidad (ejemplo: User, Equipment)
- Campos del PlantUML correspondiente

## Estructura
```typescript
import { Schema, model, Document } from 'mongoose';

export interface I{EntityName} extends Document {
  // Campos de la entidad
  // Campos de auditoría
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const {entityName}Schema = new Schema<I{EntityName}>({
  // Definir campos con tipos correctos
  // Validaciones Mongoose donde aplique
  // Referencias con ObjectId para relaciones
  
  // Campos obligatorios de auditoría
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: '{entity_name_plural}'
});

// Índices
{entityName}Schema.index({ isDeleted: 1 });
// Agregar más índices según necesidad

// Middleware pre-find para excluir eliminados por defecto
{entityName}Schema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const {EntityName} = model<I{EntityName}>('{EntityName}', {entityName}Schema);
```

## Validaciones
- Consultar `/docs/relacionTimtto.plantuml` para campos exactos
- Mapear tipos: string→String, integer→Number, boolean→Boolean, datetime→Date
- Relaciones: usar `{ type: Schema.Types.ObjectId, ref: 'EntityName' }`
- Agregar índices para campos de búsqueda frecuente