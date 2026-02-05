# Generate Complete CRUD

Genera Model + Service + Controller + Routes + DTOs para una entidad completa.

## Input Requerido
```
Nombre de entidad: {EntityName}
```

## Orden de Generación
1. Consultar `/docs/relacionTimtto.plantuml` para la entidad
2. Generar `{entityName}.model.ts` usando `generate-model.md`
3. Generar `{entityName}.dto.ts` usando `generate-dto.md`
4. Generar `{entityName}.service.ts` usando `generate-service.md`
5. Generar `{entityName}.controller.ts` usando `generate-controller.md`
6. Generar `{entityName}.routes.ts` usando `generate-routes.md`
7. Actualizar `src/app.ts` para montar las rutas

## Verificar
- ✅ Todos los campos del PlantUML están incluidos
- ✅ Soft delete implementado
- ✅ Validación Joi aplicada
- ✅ Manejo de errores en service
- ✅ Logs apropiados
- ✅ Paginación en list
- ✅ Índices MongoDB definidos