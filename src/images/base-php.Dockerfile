# refuzz's base-builder-php, in the shape of OSS-Fuzz's base-builder images (OSS-Fuzz has none for PHP): the official PHP CLI
# with Composer, pcov for line coverage, pcntl for the driver's wall-clock timer and the extensions libraries most often
# require (bcmath, gmp, intl, zip); php-fuzzer, the libFuzzer-style engine for PHP, in /opt/php-fuzzer; clang and OSS-Fuzz's
# paths ($SRC, $OUT, $WORK) and build variables; and a compile_php_fuzzer command in the manner of OSS-Fuzz's compile_*
# helpers. A spec FROM refuzz/base-builder-php builds on it: its build.sh runs `composer install` in the project's folder.
FROM php:8-cli
RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip zip curl ca-certificates clang llvm make pkg-config \
      libgmp-dev libicu-dev libzip-dev $PHPIZE_DEPS \
 && docker-php-ext-install bcmath gmp intl zip pcntl \
 && pecl install pcov && docker-php-ext-enable pcov \
 && rm -rf /var/lib/apt/lists/* /tmp/pear
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
ENV COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_NO_INTERACTION=1
RUN COMPOSER_HOME=/opt/php-fuzzer composer global require --no-progress nikic/php-fuzzer \
 && ln -s /opt/php-fuzzer/vendor/bin/php-fuzzer /usr/local/bin/php-fuzzer
ENV SRC=/src OUT=/out WORK=/work \
    CC=clang CXX=clang++ \
    CFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    CXXFLAGS="-O1 -fno-omit-frame-pointer -gline-tables-only -fsanitize=address -fsanitize-address-use-after-scope -fsanitize=fuzzer-no-link" \
    LIB_FUZZING_ENGINE=-fsanitize=fuzzer SANITIZER=address FUZZING_ENGINE=libfuzzer FUZZING_LANGUAGE=php ARCHITECTURE=aarch64
COPY php/compile_php_fuzzer /usr/local/bin/compile_php_fuzzer
RUN chmod +x /usr/local/bin/compile_php_fuzzer && mkdir -p $SRC $OUT $WORK
WORKDIR $SRC
