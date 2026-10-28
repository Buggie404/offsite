const Notification = require('../models/Notification');

async function createNotification(data) {
  try {
    const lastNotification = await Notification.findOne({}, {}, { sort: { notification_id: -1 } });
    let nextNum = 800001;
    if (lastNotification && lastNotification.notification_id) {
      const match = lastNotification.notification_id.match(/NTF(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    const notification_id = `NTF${String(nextNum).padStart(6, '0')}`;

    const newNotification = new Notification({
      notification_id,
      recipient_id: data.recipient_id,
      sender: data.sender || null,
      type: data.type,
      post_id: data.post_id || null,
      subscription_id: data.subscription_id || null,
      order_id: data.order_id || null,
      message: data.message || null,
      comment_id: data.comment_id || null,
      comment_content: data.comment_content || null,
      is_read: false
    });

    return await newNotification.save();
  } catch (error) {
    console.error('Error in createNotification service:', error);
    throw error;
  }
}

// Ritual Box notifications: never fail the caller's action.
async function notifySubscription(sub, type, message) {
  try {
    await createNotification({
      recipient_id: sub.user_id,
      sender: null,
      type,
      subscription_id: sub.subscription_id,
      order_id: sub.order_id || null,
      message: message ? String(message).slice(0, 500) : null
    });
  } catch (err) {
    console.error(`Error creating ${type} notification:`, err);
  }
}

async function getNotificationsForUser(recipient_id) {
  try {
    return await Notification.find({ recipient_id })
      .sort({ created_at: -1 })
      .limit(50);
  } catch (error) {
    console.error('Error in getNotificationsForUser service:', error);
    throw error;
  }
}

async function markAsRead(notification_id, recipient_id) {
  try {
    return await Notification.findOneAndUpdate(
      { notification_id, recipient_id },
      { $set: { is_read: true } },
      { new: true }
    );
  } catch (error) {
    console.error('Error in markAsRead service:', error);
    throw error;
  }
}

async function markAllAsRead(recipient_id) {
  try {
    return await Notification.updateMany(
      { recipient_id, is_read: false },
      { $set: { is_read: true } }
    );
  } catch (error) {
    console.error('Error in markAllAsRead service:', error);
    throw error;
  }
}

async function deleteNotification(notification_id, recipient_id) {
  try {
    return await Notification.findOneAndDelete({ notification_id, recipient_id });
  } catch (error) {
    console.error('Error in deleteNotification service:', error);
    throw error;
  }
}

async function deleteAllNotificationsForUser(recipient_id) {
  try {
    return await Notification.deleteMany({ recipient_id });
  } catch (error) {
    console.error('Error in deleteAllNotificationsForUser service:', error);
    throw error;
  }
}

module.exports = {
  createNotification,
  notifySubscription,
  getNotificationsForUser,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotificationsForUser
};

