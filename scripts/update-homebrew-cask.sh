#!/usr/bin/env bash
# Regenerate the Homebrew cask for the Kata desktop app and push it to the
# tap repo (tvcsantos/homebrew-kata). Reads the built macOS DMGs to compute
# their checksums; the cask points at the rolling `desktop-latest` release
# so its download URLs stay stable across versions.
#
# Usage: scripts/update-homebrew-cask.sh <version> <dist-dir>
#   GH_TOKEN must have contents:write on tvcsantos/homebrew-kata.
set -euo pipefail

version="${1:?version required}"
dist_dir="${2:?dist directory required}"

arm_dmg="${dist_dir}/Kata-${version}-arm64.dmg"
intel_dmg="${dist_dir}/Kata-${version}-x64.dmg"

for dmg in "$arm_dmg" "$intel_dmg"; do
  [ -f "$dmg" ] || {
    echo "error: expected DMG not found: $dmg" >&2
    exit 1
  }
done

arm_sha="$(shasum -a 256 "$arm_dmg" | awk '{print $1}')"
intel_sha="$(shasum -a 256 "$intel_dmg" | awk '{print $1}')"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --depth 1 "https://x-access-token:${GH_TOKEN}@github.com/tvcsantos/homebrew-kata.git" "$work"
mkdir -p "$work/Casks"

cat > "$work/Casks/kata.rb" <<EOF
cask "kata" do
  version "${version}"

  on_arm do
    sha256 "${arm_sha}"
    url "https://github.com/tvcsantos/kata/releases/download/desktop-latest/Kata-#{version}-arm64.dmg"
  end
  on_intel do
    sha256 "${intel_sha}"
    url "https://github.com/tvcsantos/kata/releases/download/desktop-latest/Kata-#{version}-x64.dmg"
  end

  name "Kata"
  desc "Discover and install agent-config bundles for coding agents"
  homepage "https://tiago.santos.com.pt/kata/"

  app "Kata.app"

  caveats <<~CAVEATS
    Kata is not notarized (no Apple Developer account). Install without the
    Gatekeeper quarantine:

      brew install --cask --no-quarantine tvcsantos/kata/kata

    Otherwise open it once via System Settings > Privacy & Security > Open Anyway.
  CAVEATS

  zap trash: "~/Library/Application Support/@katahq/app"
end
EOF

cd "$work"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add Casks/kata.rb
if git diff --cached --quiet; then
  echo "Cask already up to date for ${version}"
  exit 0
fi
git commit -m "kata ${version}"
git push origin HEAD
echo "Pushed cask update for kata ${version}"
