export interface ValidationErrorDetail {
  readonly field: string;
  readonly message: string;
}

export interface ValidationErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly ValidationErrorDetail[];
  };
}
