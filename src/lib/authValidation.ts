export type AuthMode = 'login' | 'register';

export interface AuthValidationInput {
  mode: AuthMode;
  fullName: string;
  phone: string;
  email: string;
  password: string;
}

export interface AuthValidationResult {
  valid: boolean;
  normalizedEmail: string;
  normalizedFullName: string;
  normalizedPhone: string | null;
  fieldErrors: Partial<Record<'fullName' | 'phone' | 'email' | 'password', string>>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateAuthForm(input: AuthValidationInput): AuthValidationResult {
  const fieldErrors: Partial<Record<'fullName' | 'phone' | 'email' | 'password', string>> = {};
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedFullName = input.fullName.trim();
  const rawPhone = input.phone.trim();

  if (input.mode === 'register') {
    if (normalizedFullName.length < 2) {
      fieldErrors.fullName = 'Please enter the shop owner’s full name (at least 2 characters).';
    }
    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13) {
        fieldErrors.phone = 'Enter a valid 10-digit Indian mobile number.';
      }
    }
  }

  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    fieldErrors.email = 'Please enter a valid email address (e.g. owner@yourshop.in).';
  }

  if (!input.password || input.password.length < 6) {
    fieldErrors.password = 'Password must be at least 6 characters.';
  }

  return {
    valid: Object.keys(fieldErrors).length === 0,
    normalizedEmail,
    normalizedFullName,
    normalizedPhone: rawPhone ? rawPhone : null,
    fieldErrors,
  };
}
