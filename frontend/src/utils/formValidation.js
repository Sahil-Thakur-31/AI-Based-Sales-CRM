export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
export const OTP_REGEX = /^\d{4,8}$/;
export const TEN_DIGIT_MOBILE_REGEX = /^\d{10}$/;

export function text(value) {
  return String(value ?? "").trim();
}

export function isBlank(value) {
  return text(value).length === 0;
}

export function required(value, label) {
  return isBlank(value) ? `${label} is required` : "";
}

export function minLength(value, count, label) {
  if (isBlank(value)) return `${label} is required`;
  return text(value).length < count ? `${label} must be at least ${count} characters` : "";
}

export function validEmail(value, label = "Email") {
  if (isBlank(value)) return `${label} is required`;
  return EMAIL_REGEX.test(text(value)) ? "" : "Invalid email format";
}

export function strongPassword(value) {
  if (isBlank(value)) return "Password is required";
  return STRONG_PASSWORD_REGEX.test(String(value))
    ? ""
    : "Password must be 8+ chars with uppercase, lowercase, number & special character";
}

export function validTenDigitMobile(value, label = "Mobile") {
  if (isBlank(value)) return `${label} is required`;
  return TEN_DIGIT_MOBILE_REGEX.test(text(value)) ? "" : `${label} must be 10 digits`;
}

