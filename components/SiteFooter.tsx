import { WaterBand } from "./decor/WaterBand";

/**
 * Site-wide footer. Carries the attribution required by the licences of the
 * data we use. Keep it on every page.
 */
export function SiteFooter() {
  return (
    <footer className="mt-10">
      <WaterBand />
      <div className="bg-water">
        <p className="text-ink mx-auto max-w-6xl px-4 py-5 text-sm">
          Place data from{" "}
          <a
            href="https://www.geonames.org/"
            className="underline underline-offset-2"
          >
            GeoNames
          </a>
          , licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            className="underline underline-offset-2"
            rel="license"
          >
            CC BY 4.0
          </a>
          . Modified: US places only, selected fields, rounded coordinates.
        </p>
      </div>
    </footer>
  );
}
