export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export class ImageTaskFailed extends ApiError { readonly taskFailed = true; }
