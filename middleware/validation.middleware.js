export const validate = (schema) => {
  return async (req, res, next) => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      next();
    } catch (error) {
      if (error.errors && error.errors.length > 0) {
        const firstError = error.errors[0];
        const errorMsg = firstError.message || `Invalid field: ${firstError.path.join('.')}`;
        return res.status(400).json({
          success: false,
          message: errorMsg,
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Invalid request payload',
        errors: []
      });
    }
  };
};
