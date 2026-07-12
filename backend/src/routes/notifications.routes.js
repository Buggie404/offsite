const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const notificationsController = require('../controllers/notifications.controller');

// All notification routes require authentication
router.use(authMiddleware);

// Get all notifications for the user
router.get('/', notificationsController.getUserNotifications);

// Mark all notifications as read (MUST be before /:id/read to prevent ID collision)
router.put('/read-all', notificationsController.markAllNotificationsAsRead);

// Mark a single notification as read
router.put('/:id/read', notificationsController.markNotificationAsRead);

// Delete all notifications (MUST be before /:id to prevent ID collision)
router.delete('/delete-all', notificationsController.deleteAllNotifications);

// Delete a single notification
router.delete('/:id', notificationsController.deleteNotification);

module.exports = router;

