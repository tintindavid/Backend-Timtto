#!/usr/bin/env node
"use strict";
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const PLANTUML = path.join(ROOT, 'docs', 'relacionTimtto.plantuml');
const OUT = path.join(ROOT, 'src');

const typeMap = (t) => {
  const tt = (t || '').toLowerCase();
  if (tt.includes('string') || tt.includes('memo') || tt.includes('file') || tt.includes('url') || tt.includes('email') || tt.includes('code')) return 'String';
  if (tt.includes('integer') || tt.includes('number') || tt.includes('decimal') || tt.includes('money')) return 'Number';
  if (tt.includes('boolean')) return 'Boolean';
  if (tt.includes('date') || tt.includes('datetime')) return 'Date';
  return 'String';
};

const pascal = (s) => s.replace(/[^a-zA-Z0-9]/g, ' ').split(/ +/).map(x => x ? x[0].toUpperCase()+x.slice(1) : '').join('');
const kebab = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/\s+/g,'-').toLowerCase();

function modelTemplate(name, fields) {
  const schemaFields = fields.map(f => `    ${f.name}: { type: ${f.type}, ${f.required ? 'required: true,' : ''} trim: true }`).join(',\n');
  return `import mongoose from 'mongoose';\n\nconst { Schema, model } = mongoose;\n\nconst ${name}Schema = new Schema({\n${schemaFields ? schemaFields + ',' : ''}\n  // Soft delete & audit\n  isDeleted: { type: Boolean, default: false },\n  deletedAt: { type: Date, default: null },\n}, {\n  timestamps: true,\n  collection: '${kebab(name)}s'\n});\n\n// Indexes\n${name}Schema.index({ isDeleted: 1 });\n${name}Schema.index({ createdAt: -1 });\n\n// Exclude sensitive fields\n${name}Schema.set('toJSON', {\n  transform: (doc, ret) => {\n    delete ret.__v;\n    delete ret.isDeleted;\n    delete ret.deletedAt;\n    return ret;\n  }\n});\n\n// Default exclude soft-deleted\n${name}Schema.pre(/^find/, function(next) {\n  this.where({ isDeleted: false });\n  next();\n});\n\nexport const ${name} = model('${name}', ${name}Schema);\n`;
}

function dtoTemplates(name) {
  const Create = `import Joi from 'joi';\n\nexport const create${name}Dto = Joi.object({\n  // TODO: ajustar validaciones por campo\n});\n`;

  const Update = `import Joi from 'joi';\n\nexport const update${name}Dto = Joi.object({\n  // Campos opcionales para actualización\n});\n`;
  const Query = `import Joi from 'joi';\n\nexport const query${name}Dto = Joi.object({\n  page: Joi.number().integer().min(1).default(1),\n  limit: Joi.number().integer().min(1).max(100).default(10),\n  sortBy: Joi.string().default('createdAt'),\n  order: Joi.string().valid('asc','desc').default('desc'),\n  search: Joi.string().optional(),\n});\n`;
  return { Create, Update, Query };
}

function serviceTemplate(name) {
  const en = name;
  const varName = en.charAt(0).toLowerCase() + en.slice(1);
  return `import { ${name} } from '@/models/${name.toLowerCase()}.model.js';\nimport { ApiError } from '@/utils/apiError.util.js';\nimport { logger } from '@/config/logger.config.js';\n\nexport class ${name}Service {\n  async create(data) {\n    try {\n      const entity = await ${name}.create(data);\n      logger.info('${name} creado: ' + entity._id);\n      return entity;\n    } catch (err) {\n      logger.error('Error creando ${varName}:', err);\n      throw new ApiError(500, 'Error creando ${name}', 'CREATE_ERROR');\n    }\n  }\n\n  async list(filters = {}, pagination = {}) {\n    try {\n      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;\n      const skip = (page - 1) * limit;\n      const query = { ...filters, isDeleted: false };\n      if (search) {\n        const rx = new RegExp(search, 'i');\n        query.$or = [{ name: rx }, { description: rx }, { title: rx }, { email: rx }];\n      }\n      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };\n      const [data, total] = await Promise.all([\n        ${name}.find(query).sort(sort).skip(skip).limit(limit).lean(),\n        ${name}.countDocuments(query),\n      ]);\n      return {\n        data,\n        pagination: {\n          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1\n        }\n      };\n    } catch (err) {\n      logger.error('Error listando ${varName}s:', err);\n      throw new ApiError(500, 'Error listando ${name}s', 'LIST_ERROR');\n    }\n  }\n\n  async getById(id) {\n    try {\n      const e = await ${name}.findById(id);\n      if (!e) throw new ApiError(404, '${name} no encontrado', 'NOT_FOUND', { id });\n      return e;\n    } catch (err) {\n      if (err instanceof ApiError) throw err;\n      logger.error('Error obteniendo ${varName}:', err);\n      throw new ApiError(500, 'Error obteniendo ${name}', 'GET_ERROR');\n    }\n  }\n\n  async update(id, data) {\n    try {\n      const e = await ${name}.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });\n      if (!e) throw new ApiError(404, '${name} no encontrado', 'NOT_FOUND', { id });\n      logger.info('${name} actualizado: ' + id);\n      return e;\n    } catch (err) {\n      if (err instanceof ApiError) throw err;\n      logger.error('Error actualizando ${varName}:', err);\n      throw new ApiError(500, 'Error actualizando ${name}', 'UPDATE_ERROR');\n    }\n  }\n\n  async delete(id) {\n    try {\n      const e = await ${name}.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });\n      if (!e) throw new ApiError(404, '${name} no encontrado', 'NOT_FOUND', { id });\n      logger.info('${name} eliminado (soft): ' + id);\n    } catch (err) {\n      if (err instanceof ApiError) throw err;\n      logger.error('Error eliminando ${varName}:', err);\n      throw new ApiError(500, 'Error eliminando ${name}', 'DELETE_ERROR');\n    }\n  }\n}\n\nexport const ${varName}Service = new ${name}Service();\n`;
}

function controllerTemplate(name) {
  const varName = name.charAt(0).toLowerCase() + name.slice(1);
  return `import { ${varName}Service } from '@/services/${varName}.service.js';\nimport { successResponse } from '@/utils/apiResponse.util.js';\n\nexport class ${name}Controller {\n  async create(req, res, next) {\n    try {\n      const data = await ${varName}Service.create(req.body);\n      res.status(201).json(successResponse(data, '${name} creado exitosamente', 201));\n    } catch (err) { next(err); }\n  }\n\n  async list(req, res, next) {\n    try {\n      const { page, limit, sortBy, order, ...filters } = req.query;\n      const result = await ${varName}Service.list(filters, { page, limit, sortBy, order, search: req.query.search });\n      res.json(successResponse(result.data, '${name}s recuperados exitosamente', 200, result.pagination));\n    } catch (err) { next(err); }\n  }\n\n  async getById(req, res, next) {\n    try {\n      const data = await ${varName}Service.getById(req.params.id);\n      res.json(successResponse(data, '${name} recuperado exitosamente'));\n    } catch (err) { next(err); }\n  }\n\n  async update(req, res, next) {\n    try {\n      const data = await ${varName}Service.update(req.params.id, req.body);\n      res.json(successResponse(data, '${name} actualizado exitosamente'));\n    } catch (err) { next(err); }\n  }\n\n  async delete(req, res, next) {\n    try {\n      await ${varName}Service.delete(req.params.id);\n      res.json(successResponse(null, '${name} eliminado exitosamente'));\n    } catch (err) { next(err); }\n  }\n}\n\nexport const ${varName}Controller = new ${name}Controller();\n`;
}

function routesTemplate(name) {
  const varName = name.charAt(0).toLowerCase() + name.slice(1);
  return `import { Router } from 'express';\nimport { ${varName}Controller } from '@/controllers/${varName}.controller.js';\nimport { authenticate } from '@/middlewares/auth.middleware.js';\nimport { validate } from '@/middlewares/validate.middleware.js';\nimport { create${name}Dto } from '@/dtos/create${name}.dto.js';\nimport { update${name}Dto } from '@/dtos/update${name}.dto.js';\nimport { query${name}Dto } from '@/dtos/query${name}.dto.js';\n\nconst router = Router();\nrouter.use(authenticate);\n\nrouter.post('/', validate(create${name}Dto, 'body'), ${varName}Controller.create);\nrouter.get('/', validate(query${name}Dto, 'query'), ${varName}Controller.list);\nrouter.get('/:id', ${varName}Controller.getById);\nrouter.put('/:id', validate(update${name}Dto, 'body'), ${varName}Controller.update);\nrouter.patch('/:id', validate(update${name}Dto, 'body'), ${varName}Controller.update);\nrouter.delete('/:id', ${varName}Controller.delete);\n\nexport default router;\n`;
}

async function run() {
  const plant = await fs.readFile(PLANTUML, 'utf-8');
  const re = /entity\s+([A-Za-z0-9_]+)\s+[^\{]*\{([\s\S]*?)\n\}/g;
  let m;
  const created = [];
  while ((m = re.exec(plant))) {
    const rawName = m[1];
    const block = m[2];
    const name = pascal(rawName);
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const fields = [];
    for (const line of lines) {
      if (line.startsWith('--')) continue;
      let l = line.replace(/^\*+/,'').replace(/<[^>]*>/g,'').replace(/\(PN\)/g,'').trim();
      const parts = l.split(':');
      if (parts.length < 2) continue;
      const namePart = parts[0].replace(/\*+/g,'').trim();
      const typePart = parts.slice(1).join(':').trim();
      const fieldName = namePart.replace(/[^a-zA-Z0-9_]/g, '') || 'field';
      const fieldType = typeMap(typePart);
      const required = /\*/.test(line) || /PN/.test(line);
      fields.push({ name: fieldName, type: fieldType, required });
    }

    if (!fields.find(f=>/id$/i.test(f.name))) fields.unshift({ name: `${rawName.toLowerCase()}Id`, type: 'String', required: false });

    const model = modelTemplate(name, fields);
    const dtos = dtoTemplates(name);
    const service = serviceTemplate(name);
    const controller = controllerTemplate(name);
    const routes = routesTemplate(name);

    await fs.mkdir(path.join(OUT,'models'), { recursive: true });
    await fs.mkdir(path.join(OUT,'dtos'), { recursive: true });
    await fs.mkdir(path.join(OUT,'services'), { recursive: true });
    await fs.mkdir(path.join(OUT,'controllers'), { recursive: true });
    await fs.mkdir(path.join(OUT,'routes'), { recursive: true });

    await fs.writeFile(path.join(OUT,'models', `${name.toLowerCase()}.model.js`), model, 'utf-8');
    await fs.writeFile(path.join(OUT,'dtos', `create${name}.dto.js`), dtos.Create, 'utf-8');
    await fs.writeFile(path.join(OUT,'dtos', `update${name}.dto.js`), dtos.Update, 'utf-8');
    await fs.writeFile(path.join(OUT,'dtos', `query${name}.dto.js`), dtos.Query, 'utf-8');
    await fs.writeFile(path.join(OUT,'services', `${name.toLowerCase()}.service.js`), service, 'utf-8');
    await fs.writeFile(path.join(OUT,'controllers', `${name.toLowerCase()}.controller.js`), controller, 'utf-8');
    await fs.writeFile(path.join(OUT,'routes', `${name.toLowerCase()}.routes.js`), routes, 'utf-8');

    created.push(name);
  }

  console.log('CRUD generated for entities:', created.join(', '));
  console.log('Remember to mount routes in src/app.js (e.g. app.use("/api/v1/<resource>", router))');
}

run().catch(err => { console.error(err); process.exit(1); });
