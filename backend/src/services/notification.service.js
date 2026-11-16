const Notification = require('../models/Notification');
const { randomUUID } = require('crypto');

async function createNotification(data) {
  try {
    // UUIDs avoid collisions when independent jobs notify concurrently.
    const notification_id = `NTF${randomUUID()}`;

    const newNotification = new Notification({
      notification_id,
      recipient_id: data.recipient_id,
      sender: data.sender || null,
      type: data.type,
      post_id: data.post_id || null,
      subscription_id: data.subscription_id || null,
      order_id: data.order_id || null,
      recipe_slug: data.recipe_slug || null,
      message: data.message || null,
      target_type: data.target_type || null,
      target_id: data.target_id == null ? null : String(data.target_id),
      ...(data.event_key ? { event_key: `${data.recipient_id}:${data.event_key}` } : {}),
      comment_id: data.comment_id || null,
      comment_content: data.comment_content || null,
      is_read: false
    });

    try { return await newNotification.save(); }
    catch (error) {
      if (error.code === 11000 && data.event_key) return null;
      throw error;
    }
  } catch (error) {
    console.error('Error in createNotification service:', error);
    throw error;
  }
}

// Failure must not undo a completed business action. Jobs can retry the same event key.
async function notifyEvent(data) {
  if (!data.recipient_id || String(data.recipient_id).startsWith('guest:')) return false;
  try {
    if (/^[a-f0-9]{24}$/i.test(String(data.recipient_id))) {
      const user = await require('../models/User').findById(data.recipient_id, 'user_id').lean();
      if (!user) return false;
      data = { ...data, recipient_id: user.user_id };
    }
    await createNotification(data); return true;
  }
  catch (error) { console.error(`Customer notification ${data.type} failed:`, error.message); return false; }
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
    return await Notification.find({ recipient_id, is_deleted: { $ne: true } })
      .sort({ created_at: -1 })
      .limit(200);
  } catch (error) {
    console.error('Error in getNotificationsForUser service:', error);
    throw error;
  }
}

async function markAsRead(notification_id, recipient_id) {
  try {
    return await Notification.findOneAndUpdate(
      { notification_id, recipient_id, is_deleted: { $ne: true } },
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
      { recipient_id, is_read: false, is_deleted: { $ne: true } },
      { $set: { is_read: true } }
    );
  } catch (error) {
    console.error('Error in markAllAsRead service:', error);
    throw error;
  }
}

async function deleteNotification(notification_id, recipient_id) {
  try {
    return await Notification.findOneAndUpdate({ notification_id, recipient_id, is_deleted: { $ne: true } },
      { $set: { is_deleted: true, is_read: true } }, { new: true });
  } catch (error) {
    console.error('Error in deleteNotification service:', error);
    throw error;
  }
}

async function deleteAllNotificationsForUser(recipient_id) {
  try {
    return await Notification.updateMany({ recipient_id, is_deleted: { $ne: true } },
      { $set: { is_deleted: true, is_read: true } });
  } catch (error) {
    console.error('Error in deleteAllNotificationsForUser service:', error);
    throw error;
  }
}

module.exports = {
  createNotification,
  notifyEvent,
  notifySubscription,
  getNotificationsForUser,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotificationsForUser
};

