# Release checklist

- [ ] Freeze the source tree and record the commit SHA.
- [ ] Run `npm ci` on a clean checkout.
- [ ] Run `npm run verify` and record the test count.
- [ ] Run `npm run bench -- --output benchmark.json`; inspect provenance and claim boundaries.
- [ ] Run `npm audit --omit=dev`.
- [ ] Run secret and forbidden-file scans against tracked files and the packed tarball.
- [ ] Run `npm pack --ignore-scripts` twice and confirm byte-identical SHA-256 digests.
- [ ] Install the tarball into a fresh DSH profile and run `--dump-config`.
- [ ] Confirm README install URLs, version, Node/DSH versions and both language documents.
- [ ] Create an immutable prerelease tag and attach the reviewed tarball plus benchmark artifact.
- [ ] Add the `dsh-plugin` GitHub topic.
- [ ] Publish only evidence-bounded release and community copy.
