/**
 * Formatea texto a título (Primera letra de cada palabra en mayúscula)
 * @param {string} text - Texto a formatear
 * @returns {string} - Texto formateado
 */
export const toTitleCase = (text) => {
  if (!text || typeof text !== 'string') return 'N/A';
  
  // Palabras que deben permanecer en minúscula (excepto al inicio)
  const minorWords = ['de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'u', 'a', 'e'];
  
  return text
    .toLowerCase()
    .trim()
    .split(' ')
    .map((word, index) => {
      // Primera palabra siempre en mayúscula
      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      // Palabras menores en minúscula (excepto si es la primera)
      if (minorWords.includes(word)) {
        return word;
      }
      // Resto de palabras con primera letra mayúscula
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
};

/**
 * Formatea texto a oración (Solo primera letra en mayúscula)
 * @param {string} text - Texto a formatear
 * @returns {string} - Texto formateado
 */
export const toSentenceCase = (text) => {
  if (!text || typeof text !== 'string') return 'N/A';
  
  const cleaned = text.toLowerCase().trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

/**
 * Formatea texto manteniendo mayúsculas (para códigos, siglas)
 * @param {string} text - Texto a formatear
 * @returns {string} - Texto formateado sin espacios extras
 */
export const toUpperCase = (text) => {
  if (!text || typeof text !== 'string') return 'N/A';
  return text.toUpperCase().trim();
};

/**
 * Formatea números de identificación (NIT, Cédula, etc.)
 * @param {string|number} value - Valor a formatear
 * @returns {string} - Valor formateado
 */
export const formatId = (value) => {
  if (!value) return 'N/A';
  return String(value).trim().replace(/\s+/g, '');
};

/**
 * Formatea email
 * @param {string} email - Email a formatear
 * @returns {string} - Email formateado
 */
export const formatEmail = (email) => {
  if (!email || typeof email !== 'string') return 'N/A';
  return email.toLowerCase().trim();
};

/**
 * Formatea teléfono
 * @param {string} phone - Teléfono a formatear
 * @returns {string} - Teléfono formateado
 */
export const formatPhone = (phone) => {
  if (!phone) return 'N/A';
  return String(phone).trim().replace(/\s+/g, ' ');
};
