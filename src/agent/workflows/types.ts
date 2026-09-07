export interface AuthResult {
  success: boolean;
  authenticated: boolean;
  user?: string;
  reason?: string;
  error?: string;
  code?: string;
}

export interface LoginFormSelectors {
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

export interface RegistrationFormSelectors {
  usernameSelector?: string;
  emailSelector?: string;
  passwordSelector?: string;
  confirmPasswordSelector?: string;
  submitSelector?: string;
}
