import { Suspense } from "react";
import { isStaticOnlyLaunch } from "@/lib/launchMode";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm registrationOpen={!isStaticOnlyLaunch()} />
    </Suspense>
  );
}
