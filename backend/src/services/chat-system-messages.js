const SUPPORT_JOINED = 'A customer support agent has joined the conversation.';

function englishSystemText(text) {
  return text === 'Một nhân viên CSKH đã tham gia cuộc trò chuyện.' ? SUPPORT_JOINED : text;
}

module.exports = { SUPPORT_JOINED, englishSystemText };
