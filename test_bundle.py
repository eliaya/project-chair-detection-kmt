"""scripts/build_pi_bundle.py: Debian version order and dependency resolution (no network)."""

import importlib.util
import os
import unittest

_spec = importlib.util.spec_from_file_location(
    "build_pi_bundle", os.path.join(os.path.dirname(__file__), "scripts", "build_pi_bundle.py"))
bundle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bundle)


def stanza(name, version="1", **fields):
    return {"Package": name, "Version": version, **{k.replace("_", "-"): v for k, v in fields.items()}}


class TestVersionCmp(unittest.TestCase):
    def test_dpkg_order(self):
        older_newer = [
            ("1.0~rc1", "1.0"),
            ("1.0", "1.0a"),
            ("1.0a", "1.0+"),
            ("2.0", "1:0.1"),
            ("1.8.11-2", "1.8.11-2+deb13u1"),
            ("5:29.9.2-1~debian.13~trixie", "5:29.10.0-1~debian.13~trixie"),
        ]
        for a, b in older_newer:
            self.assertLess(bundle.version_cmp(a, b), 0, (a, b))
            self.assertGreater(bundle.version_cmp(b, a), 0, (b, a))
        self.assertEqual(bundle.version_cmp("1.0-1", "1.0-1"), 0)


class TestResolve(unittest.TestCase):
    def test_follows_depends_skips_required_and_picks_existing_alternative(self):
        best = {s["Package"]: s for s in [
            stanza("docker-ce", Depends="iptables (>= 1.6), libc6, missing-pkg | nftables:any"),
            stanza("iptables", Pre_Depends="libxtables12"),
            stanza("libxtables12"),
            stanza("libc6", Priority="required"),
            stanza("nftables"),
            stanza("mawk", Provides="awk"),
            stanza("whiptail", Depends="awk"),
        ]}
        provides = {"awk": "mawk"}
        got = bundle.resolve(best, provides, ["docker-ce", "whiptail"])
        self.assertEqual(sorted(got),
                         ["docker-ce", "iptables", "libxtables12", "mawk", "nftables", "whiptail"])


if __name__ == "__main__":
    unittest.main()
