import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  emailOtp, // sendVerificationOtp / verifyEmail / requestPasswordReset / resetPassword: 8-digit codes by e-mail
  changePassword,
  updateUser,
  deleteUser,
} = createAuthClient({
  fetchOptions: { credentials: 'include' },
  plugins: [emailOTPClient()],
});
