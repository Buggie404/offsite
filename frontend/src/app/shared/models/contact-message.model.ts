export const CONTACT_SUBJECTS = [
  'General Inquiry',
  'Order Status',
  'Product Support',
  'Partnership',
  'Feedback',
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

/** contact_form: Contact Us page · chatbot: fallback form shown when the assistant fails */
export type ContactSource = 'contact_form' | 'chatbot';

export interface ContactMessageRequest {
  full_name?: string;
  email: string;
  subject?: ContactSubject;
  message: string;
  source: ContactSource;
  chat_session_id?: string | null;
}

export interface ContactMessageResponse {
  success: boolean;
  contact_id: string;
  message: string;
}

/** Error body for 400 responses; field tells the form which input to mark */
export interface ContactMessageError {
  success: false;
  field?: 'full_name' | 'email' | 'message';
  message: string;
}
