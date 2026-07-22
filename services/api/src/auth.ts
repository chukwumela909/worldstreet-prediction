import { clerkClient, getAuth } from "@clerk/fastify";
import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { User, type IUser } from "./models.js";

export interface AuthenticatedUser {
  authUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  dbUser: IUser;
}

function makeBaseUsername(firstName: string, lastName: string) {
  const fromName = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  return fromName.slice(0, 24) || `trader${Date.now()}`;
}

async function findAvailableUsername(base: string) {
  let candidate = base;
  let suffix = 0;

  while (await User.exists({ username: candidate })) {
    suffix += 1;
    candidate = `${base.slice(0, 24)}${suffix}`;
  }

  return candidate;
}

/**
 * Verify the forwarded Clerk session JWT and return the local profile,
 * auto-provisioning it on first sight — same flow as the other WorldStreet
 * satellite platforms, so one central login works everywhere.
 */
export async function authenticate(
  request: FastifyRequest,
): Promise<AuthenticatedUser> {
  const { userId } = getAuth(request);

  if (!userId) {
    throw new ApiError(401, "Authentication required", "UNAUTHORIZED");
  }

  let dbUser = await User.findOne({ authUserId: userId });
  const clerkUser = await clerkClient.users.getUser(userId);
  const primaryEmail =
    clerkUser.emailAddresses.find(
      (email) => email.id === clerkUser.primaryEmailAddressId,
    ) ?? clerkUser.emailAddresses[0];
  const email = primaryEmail?.emailAddress.toLowerCase() ?? "";
  const firstName = clerkUser.firstName ?? "";
  const lastName = clerkUser.lastName ?? "";

  if (!email) {
    throw new ApiError(
      422,
      "A verified email address is required",
      "EMAIL_REQUIRED",
    );
  }

  if (!dbUser) {
    const baseUsername = makeBaseUsername(firstName, lastName);
    const username = await findAvailableUsername(baseUsername);

    try {
      dbUser = await User.create({
        authUserId: userId,
        email,
        username,
        displayName: `${firstName} ${lastName}`.trim() || "Anonymous",
        avatar:
          clerkUser.imageUrl ||
          `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(userId)}`,
      });
    } catch (error) {
      // Unique-index race with a concurrent first request: the other writer
      // won, so read their row instead of failing the request.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      ) {
        dbUser = await User.findOne({ authUserId: userId });
      }
      if (!dbUser) throw error;
    }
  }

  return {
    authUserId: userId,
    email,
    firstName,
    lastName,
    role: String(clerkUser.publicMetadata.role ?? "user"),
    dbUser,
  };
}

export function getOptionalAuthUserId(request: FastifyRequest) {
  return getAuth(request).userId ?? null;
}
