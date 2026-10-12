import type { Metadata } from 'next';
import { connection } from 'next/server';

import { AuthForm } from '../auth-form';
import { text } from '../text';

import { googleClient } from '@/lib/auth';

export const metadata: Metadata = { title: text.signUp.title };

export default async function RegisterPage() {
  await connection(); // read at request time: the Google button follows the project's secrets
  return <AuthForm google={googleClient() !== null} mode="sign-up" />;
}
