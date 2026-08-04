/**
 * The gate.
 *
 * This is the first page anyone sees, and until now it was a bare card in the
 * middle of an empty page — it neither looked like the product nor said what
 * the product was. It carries the masthead now, for the same reason a
 * publication puts its name on the cover: so the page you land on and the page
 * you sign in to are recognisably the same thing.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm" data-press="gate">
        <div data-press="gate-masthead">
          {/* Two plates, as in the sidebar: the second slides into register on
              load. `aria-hidden`, so the name is announced once. */}
          <div data-press="lockup">
            <span data-press="mark" aria-hidden="true">
              ¶
            </span>
            <div data-press="wordmark">
              Pilcrow
              <span aria-hidden="true">Pilcrow</span>
            </div>
          </div>
        </div>

        {children}
      </div>
    </main>
  );
}
