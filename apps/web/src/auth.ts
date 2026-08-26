import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { ensureIdentityWorkspace, getUserByGithubId } from "@skilled/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile, user }) {
      if (!profile?.id) return false;
      await ensureIdentityWorkspace({
        githubUserId: String(profile.id),
        name:
          user.name ?? (profile.login as string | undefined) ?? "GitHub user",
        ...(user.email !== undefined ? { email: user.email } : {}),
        ...(user.image !== undefined ? { image: user.image } : {}),
      });
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.id) token.githubUserId = String(profile.id);
      if (token.githubUserId && !token.userId) {
        const user = await getUserByGithubId(token.githubUserId);
        if (user) token.userId = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId) session.user.id = token.userId;
      return session;
    },
  },
});
