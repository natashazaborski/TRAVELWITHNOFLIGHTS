/**
 * Site-wide footer. Carries the attribution required by the licences of the
 * data we use. Keep it on every page.
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto max-w-xl px-4 py-6 text-sm text-gray-600">
      <p>
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
    </footer>
  );
}
