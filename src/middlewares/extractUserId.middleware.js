/**
 * Middleware para extraer userId de headers o token JWT
 * Prioridad: x-user-id header > JWT token > undefined
 */
export const extractUserId = (req, res, next) => {
  try {
    // 1. Intentar obtener del header x-user-id
    const userIdFromHeader = req.headers['x-user-id'];
    
    // 2. Intentar obtener del token JWT (si existe req.user)
    const userIdFromToken = req.user?.id || req.user?._id;
    
    // 3. Asignar userId a req
    req.userId = userIdFromHeader || userIdFromToken || null;
    
    next();
  } catch (error) {
    next(error);
  }
};
