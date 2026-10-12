// `npm run mobile:setup` (plan 06 §14): creates android/ (or ios/ with MOBILE_TARGET=ios) once; on Android it
// (re)applies the one Gradle patch the build needs — version and release signing read from the build's env only,
// never from gradle.properties or the repo. Without TOTALUM_KEYSTORE_PATH a release build is unsigned (the Sprite
// signs it, A7.10). iOS takes its bundle id and version at build time (scripts/mobile-build.mjs).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { onlyOnCodemagic } from './mobile-paths.mjs';

onlyOnCodemagic();

const MARKER = '// totalum:mobile-build (plan 06 §14, A7.10)';
const PATCH = `
${MARKER} — version and release signing from the build env only
android {
    defaultConfig {
        versionCode((System.getenv('TOTALUM_VERSION_CODE') ?: '1') as int)
        versionName(System.getenv('TOTALUM_VERSION_NAME') ?: '1.0.0')
    }
    signingConfigs {
        totalumRelease {
            if (System.getenv('TOTALUM_KEYSTORE_PATH')) {
                storeFile file(System.getenv('TOTALUM_KEYSTORE_PATH'))
                storePassword System.getenv('TOTALUM_STORE_PASSWORD')
                keyAlias System.getenv('TOTALUM_KEY_ALIAS')
                keyPassword System.getenv('TOTALUM_KEY_PASSWORD')
            }
        }
    }
    buildTypes {
        release {
            if (System.getenv('TOTALUM_KEYSTORE_PATH')) signingConfig signingConfigs.totalumRelease
        }
    }
}
`;

const target = process.env.MOBILE_TARGET === 'ios' ? 'ios' : 'android';
if (!existsSync(target)) execFileSync('npx', ['cap', 'add', target], { stdio: 'inherit' });
if (target === 'ios') process.exit(0);
const gradle = 'android/app/build.gradle';
if (!readFileSync(gradle, 'utf8').includes(MARKER)) appendFileSync(gradle, PATCH);
