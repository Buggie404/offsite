const { notifyEvent } = require('./notification.service');

async function notifyContent(document, kind, hidden) {
  if (!document) return;
  const id = kind === 'comment' ? document.comment_id : document.post_id;
  await notifyEvent({ recipient_id: document.user_id,
    type: hidden ? 'COMMUNITY_CONTENT_HIDDEN' : 'COMMUNITY_CONTENT_RESTORED',
    event_key: `content:${kind}:${id}:${hidden}:${new Date(document.updated_at).getTime()}`,
    post_id: document.post_id, comment_id: document.comment_id || null,
    target_type: 'post', target_id: document.post_id,
    message: `Your ${kind} was ${hidden ? 'hidden after moderation' : 'restored and is visible again'}.`
  });
}

module.exports = { notifyContent };
