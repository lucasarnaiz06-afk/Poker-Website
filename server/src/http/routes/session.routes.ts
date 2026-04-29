import { Router } from "express";
import { authenticateCookieHeader } from "../../security/session";

export const sessionRouter = Router();

sessionRouter.get("/me", async (request, response, next) => {
  try {
    const session = await authenticateCookieHeader(request.headers.cookie);

    if (!session) {
      response.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }

    response.json({
      user: session.user,
      expires: session.expires.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
