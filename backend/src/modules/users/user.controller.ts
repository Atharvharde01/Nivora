import { Request, Response, NextFunction } from "express";
import { UserProfileError, UserService } from "./user.service";

export interface UserControllerDependencies {
  userService?: UserService;
}

export class UserController {
  private readonly userService: UserService;

  constructor(dependencies: UserControllerDependencies = {}) {
    this.userService = dependencies.userService ?? new UserService();
  }

  /**
   * PATCH /api/v1/users/me/profile
   * Updates only the authenticated user's displayName using req.user._id exclusively.
   */
  public updateMyProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const authenticatedUserId = req.user?._id;
      if (!authenticatedUserId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const updatedUser = await this.userService.updateDisplayName(
        authenticatedUserId,
        req.body?.displayName
      );

      res.status(200).json({
        success: true,
        data: {
          user: updatedUser,
        },
      });
    } catch (err: unknown) {
      if (err instanceof UserProfileError) {
        res.status(err.statusCode).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }
      next(err);
    }
  };
}
