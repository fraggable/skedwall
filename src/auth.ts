import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { GOOGLE_AUTH_SCOPE } from "@/lib/google-scopes";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "database",
  },
  callbacks: {
    async signIn({ account, user }) {
      if (account?.provider !== "google" || !user.email) {
        return true;
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true },
      });

      if (!existingUser) {
        return true;
      }

      await prisma.account.updateMany({
        where: {
          userId: existingUser.id,
          provider: "google",
        },
        data: {
          access_token: account.access_token ?? undefined,
          refresh_token: account.refresh_token ?? undefined,
          expires_at: account.expires_at ?? undefined,
          token_type: account.token_type ?? undefined,
          scope: account.scope ?? undefined,
          id_token: account.id_token ?? undefined,
        },
      });

      return true;
    },
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: GOOGLE_AUTH_SCOPE,
          access_type: "offline",
          prompt: "consent",
          response_type: "code",
        },
      },
    }),
  ],
});