import { auth, signIn, signOut } from "@/auth";

export async function UserMenu() {
  const session = await auth();

  if (!session?.user) {
    return (
      <form
        action={async () => {
          "use server";
          await signIn("google");
        }}
      >
        <button
          type="submit"
          className="cursor-pointer rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90"
        >
          Continue with Google
        </button>
      </form>
    );
  }

  return (
    <form
      action={async () => {
        "use server";
        await signOut();
      }}
      className="flex items-center gap-3"
    >
      <span className="text-sm text-muted">
        {session.user.name ?? session.user.email}
      </span>
      <button
        type="submit"
        className="cursor-pointer rounded-md border border-hairline px-3 py-1.5 text-sm text-muted transition-colors duration-200 hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
