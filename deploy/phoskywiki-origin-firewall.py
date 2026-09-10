#!/usr/bin/python3
"""Filter public web traffic before Docker DNAT; preserve SSH and host recovery."""
import ipaddress
import json
from pathlib import Path
import re
import subprocess


def main():
    routes = json.loads(subprocess.check_output(['ip', '-j', 'route', 'show', 'default']))
    interfaces = sorted({route['dev'] for route in routes})
    # Include an IPv6-only uplink if one is configured later.
    routes6 = json.loads(subprocess.check_output(['ip', '-j', '-6', 'route', 'show', 'default']))
    interfaces = sorted(set(interfaces) | {route['dev'] for route in routes6})
    if not interfaces or not all(re.fullmatch(r'[a-zA-Z0-9_.:-]+', name) for name in interfaces):
        raise ValueError('UPLINK_REQUIRED')
    networks = [ipaddress.ip_network(value) for value in Path('/opt/phoskywiki/deploy/cloudflare-cidrs.txt').read_text().split()]
    if not networks or any(network.prefixlen == 0 for network in networks):
        raise ValueError('CLOUDFLARE_RANGES_REQUIRED')
    rules = ['add table inet phoskywiki_origin', 'flush table inet phoskywiki_origin',
             'add chain inet phoskywiki_origin ingress { type filter hook prerouting priority -150; policy accept; }']
    for version, family in [(4, 'ip'), (6, 'ip6')]:
        ranges = ', '.join(str(network) for network in networks if network.version == version)
        if not ranges:
            raise ValueError('BOTH_ADDRESS_FAMILIES_REQUIRED')
        for interface in interfaces:
            rules.append(f'add rule inet phoskywiki_origin ingress iifname "{interface}" {family} saddr != {{ {ranges} }} tcp dport {{ 80, 443 }} drop')
    config = '\n'.join(rules) + '\n'
    subprocess.run(['nft', '--check', '-f', '-'], input=config, text=True, check=True, capture_output=True)
    subprocess.run(['nft', '-f', '-'], input=config, text=True, check=True, capture_output=True)
    print(json.dumps({'ok': True, 'interfaces': interfaces, 'ipv4Ranges': sum(n.version == 4 for n in networks), 'ipv6Ranges': sum(n.version == 6 for n in networks)}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('ORIGIN_FIREWALL_FAILED')
        raise SystemExit(1)
