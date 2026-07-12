const User = require('../models/User');
const notificationService = require('../services/notification.service');

async function getUserNotifications(req, res) {
  try {
    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const notifications = await notificationService.getNotificationsForUser(user.user_id);
    res.json({ data: notifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to retrieve notifications' });
  }
}

async function markNotificationAsRead(req, res) {
  try {
    const { id } = req.params; // notification_id
    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const updatedNotification = await notificationService.markAsRead(id, user.user_id);
    if (!updatedNotification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read', data: updatedNotification });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
}

async function markAllNotificationsAsRead(req, res) {
  try {
    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    await notificationService.markAllAsRead(user.user_id);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
}

async function deleteNotification(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const deleted = await notificationService.deleteNotification(id, user.user_id);
    if (!deleted) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
}

async function deleteAllNotifications(req, res) {
  try {
    const user = await User.findById(req.user.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    await notificationService.deleteAllNotificationsForUser(user.user_id);
    res.json({ message: 'All notifications deleted successfully' });
  } catch (error) {
    console.error('Error deleting all notifications:', error);
    res.status(500).json({ error: 'Failed to delete all notifications' });
  }
}

module.exports = {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  deleteAllNotifications
};

