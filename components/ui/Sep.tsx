/**
 * " · " between inline facts. Overpass's middle dot sits close to the next
 * word, so it gets extra room on the right. Real spaces are kept so screen
 * readers still hear separate words.
 */
export function Sep() {
  return (
    <>
      {" "}
      <span className="text-ink-muted pr-1">·</span>{" "}
    </>
  );
}
