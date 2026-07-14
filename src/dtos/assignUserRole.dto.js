'use strict';

import Joi from 'joi';

export const assignUserRoleDto = Joi.object({
  roleId: Joi.string().hex().length(24).required(),
});