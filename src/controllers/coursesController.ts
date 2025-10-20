import { Request, Response } from 'express';
import { MoodleService } from '../services/moodleService';
import { createError } from '../middleware/errorHandler';

export class CoursesController {
  private moodleService: MoodleService;

  constructor() {
    this.moodleService = new MoodleService();
  }

  /**
   * Get courses by category ID
   * GET /api/cursos/categoria/:id
   */
  getCoursesByCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    
    // Validate category ID
    const categoryId = parseInt(id, 10);
    if (isNaN(categoryId) || categoryId <= 0) {
      throw createError('Invalid category ID. Must be a positive number', 400);
    }

    // Call Moodle service
    const result = await this.moodleService.getCoursesByCategory(categoryId);

    if (!result.success) {
      throw createError(
        result.error?.message || 'Failed to fetch courses',
        result.error?.code === 'invalidtoken' ? 401 : 500
      );
    }

    // Return successful response
    res.json({
      success: true,
      data: {
        categoryId,
        courses: result.data?.courses || [],
        total: result.data?.courses?.length || 0,
        warnings: result.data?.warnings || []
      }
    });
  };

  /**
   * Get simplified courses by category ID (only essential fields)
   * GET /api/cursos/categoria/:id/simplificado
   */
  getSimplifiedCoursesByCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    
    // Validate category ID
    const categoryId = parseInt(id, 10);
    if (isNaN(categoryId) || categoryId <= 0) {
      throw createError('Invalid category ID. Must be a positive number', 400);
    }

    // Call Moodle service for simplified courses
    const result = await this.moodleService.getSimplifiedCoursesByCategory(categoryId);

    if (!result.success) {
      throw createError(
        result.error?.message || 'Failed to fetch simplified courses',
        result.error?.code === 'invalidtoken' ? 401 : 500
      );
    }

    // Return successful response
    res.json({
      success: true,
      data: {
        categoryId,
        courses: result.data?.courses || [],
        total: result.data?.courses?.length || 0,
        warnings: result.data?.warnings || []
      }
    });
  };

  /**
   * Get courses by any field
   * GET /api/cursos/field/:field/:value
   */
  getCoursesByField = async (req: Request, res: Response): Promise<void> => {
    const { field, value } = req.params;
    
    // Validate parameters
    if (!field || !value) {
      throw createError('Field and value parameters are required', 400);
    }

    // Validate field name (whitelist allowed fields for security)
    const allowedFields = ['category', 'id', 'shortname', 'idnumber', 'visible'];
    if (!allowedFields.includes(field)) {
      throw createError(
        `Invalid field '${field}'. Allowed fields: ${allowedFields.join(', ')}`,
        400
      );
    }

    // Call Moodle service
    const result = await this.moodleService.getCoursesByField(field, value);

    if (!result.success) {
      throw createError(
        result.error?.message || 'Failed to fetch courses',
        result.error?.code === 'invalidtoken' ? 401 : 500
      );
    }

    // Return successful response
    res.json({
      success: true,
      data: {
        field,
        value,
        courses: result.data?.courses || [],
        total: result.data?.courses?.length || 0,
        warnings: result.data?.warnings || []
      }
    });
  };

  /**
   * Get all categories with optional parent filter
   * GET /api/categorias
   * GET /api/categorias?parent=0
   */
  getCategories = async (req: Request, res: Response): Promise<void> => {
    const { parent } = req.query;
    
    let parentId: number | undefined;
    
    // Parse parent parameter if provided
    if (parent !== undefined) {
      parentId = parseInt(parent as string, 10);
      if (isNaN(parentId) || parentId < 0) {
        throw createError('Invalid parent ID. Must be a non-negative number', 400);
      }
    }

    // Call Moodle service
    const result = await this.moodleService.getCategories(parentId);

    if (!result.success) {
      throw createError(
        result.error?.message || 'Failed to fetch categories',
        result.error?.code === 'invalidtoken' ? 401 : 500
      );
    }

    // Return successful response
    res.json({
      success: true,
      data: {
        parentId,
        categories: result.data?.categories || [],
        total: result.data?.categories?.length || 0,
        warnings: result.data?.warnings || []
      }
    });
  };

  /**
   * Get root categories only (parent = 0)
   * GET /api/categorias/raiz
   */
  getRootCategories = async (req: Request, res: Response): Promise<void> => {
    // Call Moodle service
    const result = await this.moodleService.getRootCategories();

    if (!result.success) {
      throw createError(
        result.error?.message || 'Failed to fetch root categories',
        result.error?.code === 'invalidtoken' ? 401 : 500
      );
    }

    // Return successful response
    res.json({
      success: true,
      data: {
        parentId: 0,
        categories: result.data?.categories || [],
        total: result.data?.categories?.length || 0,
        warnings: result.data?.warnings || []
      }
    });
  };

  /**
   * Health check endpoint
   * GET /api/health
   */
  healthCheck = async (req: Request, res: Response): Promise<void> => {
    const result = await this.moodleService.healthCheck();

    if (!result.success) {
      throw createError(
        'Moodle connection failed: ' + (result.error?.message || 'Unknown error'),
        503
      );
    }

    res.json({
      success: true,
      message: 'API is healthy and connected to Moodle',
      timestamp: new Date().toISOString(),
      moodle: {
        connected: true,
        siteInfo: result.data
      }
    });
  };
}
