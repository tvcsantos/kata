import { useEffect, useState } from "react";
import type { RegistryBundle, RegistryView } from "../../shared/registry";
import { ErrorBoundary } from "./ErrorBoundary";
import { Splash } from "./Splash";
import { UpdateBanner } from "./UpdateBanner";
import { AboutScreen } from "./screens/AboutScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { BundleDetailScreen } from "./screens/BundleDetailScreen";
import { InstallModal } from "./screens/InstallModal";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { RegistriesScreen } from "./screens/RegistriesScreen";
import { RegistrySetupScreen } from "./screens/RegistrySetupScreen";

/**
 * First run is two mandatory steps - pick at least one registry, then at
 * least one persona (personas come from the fetched registries) - then
 * the app lives on Browse. Installs pick their target project in the
 * modal, so no project is ever "selected" app-wide.
 */
export function App(): React.JSX.Element {
  const [splashDone, setSplashDone] = useState(false);
  const [registry, setRegistry] = useState<RegistryView | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  /** false = none configured (first-run setup); undefined = still loading. */
  const [hasRegistries, setHasRegistries] = useState<boolean | undefined>(undefined);
  const [bundle, setBundle] = useState<RegistryBundle | null>(null);
  const [installing, setInstalling] = useState<RegistryBundle | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showRegistries, setShowRegistries] = useState(false);
  const [showWorkProfile, setShowWorkProfile] = useState(false);
  const [activePersonas, setActivePersonas] = useState<string[]>([]);
  /** null = never onboarded (show picker); undefined = still loading. */
  const [storedPersonas, setStoredPersonas] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    void window.kata.getPersonas().then((slugs) => {
      setStoredPersonas(slugs);
      if (slugs && slugs.length > 0) setActivePersonas(slugs);
    });
    void window.kata.getRegistries().then((sources) => setHasRegistries(sources.length > 0));
  }, []);

  async function loadRegistry(refresh: boolean): Promise<void> {
    setRegistryError(null);
    try {
      setRegistry(await window.kata.getRegistry({ refresh }));
    } catch (err) {
      setRegistryError((err as Error).message);
    }
  }

  useEffect(() => {
    if (hasRegistries === true && registry === null && registryError === null) {
      void loadRegistry(false);
    }
  }, [hasRegistries, registry, registryError]);

  function completeRegistrySetup(): void {
    setHasRegistries(true);
  }

  function completeOnboarding(slugs: string[]): void {
    setStoredPersonas(slugs);
    setActivePersonas(slugs);
    void window.kata.setPersonas(slugs);
  }

  function togglePersona(slug: string): void {
    setActivePersonas((current) =>
      current.includes(slug) ? current.filter((other) => other !== slug) : [...current, slug],
    );
  }

  function renderScreen(): React.JSX.Element {
    if (hasRegistries === undefined || storedPersonas === undefined) {
      return (
        <section>
          <h1>Bundles</h1>
          <p className="empty">Loading…</p>
        </section>
      );
    }
    // First-run step 1: at least one registry must exist.
    if (hasRegistries === false) {
      return <RegistrySetupScreen onDone={completeRegistrySetup} />;
    }
    if (registryError) {
      return (
        <section>
          <h1>Bundles</h1>
          <div className="notice">
            <p>{registryError}</p>
            <button onClick={() => void loadRegistry(true)}>Retry</button>
          </div>
          <button onClick={() => setHasRegistries(false)}>Manage registries</button>
        </section>
      );
    }
    if (!registry) {
      return (
        <section>
          <h1>Bundles</h1>
          <p className="empty">Loading the registry…</p>
        </section>
      );
    }
    // First-run step 2: what kind of work - personas from the registries.
    if (storedPersonas === null) {
      return <OnboardingScreen personas={registry.personas} onDone={completeOnboarding} />;
    }
    if (showWorkProfile) {
      return (
        <OnboardingScreen
          personas={registry.personas}
          initialSelection={storedPersonas ?? []}
          onBack={() => setShowWorkProfile(false)}
          onDone={(slugs) => {
            completeOnboarding(slugs);
            setShowWorkProfile(false);
          }}
        />
      );
    }
    if (showAbout) {
      return <AboutScreen onBack={() => setShowAbout(false)} />;
    }
    if (showRegistries) {
      return (
        <RegistriesScreen
          sourceViews={registry.sources}
          onBack={() => setShowRegistries(false)}
          onChanged={() => void loadRegistry(true)}
        />
      );
    }
    if (bundle) {
      return (
        <BundleDetailScreen
          bundle={bundle}
          onBack={() => setBundle(null)}
          onInstall={() => setInstalling(bundle)}
        />
      );
    }
    return (
      <BrowseScreen
        view={registry}
        activePersonas={activePersonas}
        onTogglePersona={togglePersona}
        onSetPersonas={setActivePersonas}
        onSelect={setBundle}
        onRefresh={() => void loadRegistry(true)}
        onRegistries={() => setShowRegistries(true)}
        onWorkProfile={() => setShowWorkProfile(true)}
        onAbout={() => setShowAbout(true)}
      />
    );
  }

  if (!splashDone) {
    return <Splash onDone={() => setSplashDone(true)} />;
  }

  return (
    <main>
      <UpdateBanner />
      <div className="content screen-in">
        <ErrorBoundary>
          {renderScreen()}
          {installing && <InstallModal bundle={installing} onClose={() => setInstalling(null)} />}
        </ErrorBoundary>
      </div>
    </main>
  );
}
