# Matriz Lighthouse — 2026-10-16

Complementa [metodología y límites](PERFORMANCE_20261016.md). 72 pares baseline→combinado actual, misma máquina, build de producción, cuatro categorías. Baseline7a19a468; combinado51ea5b84 sobre development86d1ccd6 (PR425 más esta optimización). La comparación NO aísla cambios de cards de PR425; comparación aislada histórica en evidencia externa after-matrix.json. Una muestra por par: no comparar pequeñas variaciones como mejoras causales. P/A/BP/SEO son puntuaciones; LCP/FCP/TBT/SI en ms, CLS sin unidad, transferencia/JS en bytes. ADMIN tiene sesión SSR legítima, HTTP200 y URL final exacta; SEO100 es la ausencia de noindex del baseline, entregada al owner SEO, no una recomendación. Verificación pública SEO60 conserva noindex correcto.

| Ruta | Dispositivo | P/A/BP/SEO antes→después | LCP | CLS | TBT | FCP | SI | Transferencia | JS |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| landing | mobile | 92/96/100/100→92/96/100/92 | 2861→2860 | 0.0016→0.0013 | 0→0 | 2411→2410 | 2411→2410 | 352236→351009 | 2627→2627 |
| landing | desktop | 100/96/100/100→100/96/100/100 | 690→688 | 0.0010→0.0009 | 0→0 | 555→572 | 555→628 | 465831→464629 | 2627→2627 |
| catalog | mobile | 95/100/100/100→95/100/100/100 | 2411→2340 | 0.0026→0.0026 | 0→0 | 2336→2265 | 2336→2265 | 201005→201031 | 2627→2627 |
| catalog | desktop | 100/100/100/100→100/100/100/100 | 548→529 | 0.0020→0.0020 | 0→0 | 548→529 | 548→551 | 201005→201031 | 2627→2627 |
| course | mobile | 92/100/100/100→96/100/100/100 | 2900→2259 | 0.0023→0.0023 | 7→0 | 2281→2259 | 2281→2259 | 686804→686830 | 507518→507518 |
| course | desktop | 99/100/100/100→98/100/100/100 | 895→958 | 0.0020→0.0020 | 0→0 | 719→735 | 719→735 | 705662→705688 | 507518→507518 |
| login | mobile | 93/95/100/100→94/95/100/100 | 1968→1655 | 0.1302→0.1302 | 8→0 | 1968→1580 | 1968→1580 | 589872→589898 | 431273→431273 |
| login | desktop | 99/95/100/100→100/95/100/100 | 851→648 | 0.0001→0.0259 | 0→0 | 653→570 | 653→570 | 589872→589898 | 431273→431273 |
| verification | mobile | 95/100/100/60→97/100/100/60 | 2409→2108 | 0.0218→0.0217 | 0→0 | 2334→2108 | 2334→2108 | 219797→219823 | 6227→6227 |
| verification | desktop | 100/100/100/60→100/100/100/60 | 529→531 | 0.0180→0.0189 | 0→0 | 529→531 | 529→531 | 219797→219823 | 6227→6227 |
| admin-courses | mobile | 76/96/100/100→74/96/100/100 | 4565→4808 | 0.0008→0.0008 | 8→40 | 3563→3685 | 3563→3685 | 774073→774099 | 521519→521519 |
| admin-courses | desktop | 98/96/100/100→98/96/100/100 | 1011→1048 | 0.0003→0.0003 | 0→0 | 813→830 | 813→830 | 793067→793093 | 521519→521519 |
| admin-course-new | mobile | 74/96/100/100→87/96/100/100 | 4848→3327 | 0.0000→0.0003 | 0→2 | 3705→3018 | 3705→3018 | 913703→913729 | 657332→657332 |
| admin-course-new | desktop | 97/96/100/100→98/96/100/100 | 1046→1030 | 0.0163→0.0162 | 0→0 | 835→762 | 934→762 | 932697→932723 | 657332→657332 |
| admin-course-edit | mobile | 72/96/100/100→95/96/100/100 | 5105→2410 | 0.0023→0.0023 | 1→0 | 3982→2410 | 3982→2410 | 927467→927493 | 663437→663437 |
| admin-course-edit | desktop | 86/96/100/100→90/96/100/100 | 1025→1023 | 0.2390→0.1766 | 0→0 | 757→776 | 757→776 | 946461→946487 | 663437→663437 |
| admin-groups | mobile | 78/100/100/100→76/100/100/100 | 2408→2708 | 0.3351→0.3351 | 0→0 | 2408→2633 | 2408→2633 | 639492→639518 | 405078→405078 |
| admin-groups | desktop | 99/96/100/100→98/96/100/100 | 895→969 | 0.0146→0.0146 | 0→0 | 733→771 | 733→771 | 658486→658512 | 405078→405078 |
| admin-participants | mobile | 75/100/100/100→65/100/100/100 | 3172→4357 | 0.2626→0.2619 | 0→0 | 2790→3383 | 2790→3383 | 600909→600935 | 394670→394670 |
| admin-participants | desktop | 99/96/100/100→99/96/100/100 | 930→894 | 0.0009→0.0009 | 0→0 | 749→732 | 749→732 | 619903→619929 | 394670→394670 |
| admin-sessions | mobile | 77/96/100/100→70/96/100/100 | 5855→5706 | 0.0352→0.0221 | 14→35 | 1955→3907 | 1955→3907 | 814615→814641 | 593444→593444 |
| admin-sessions | desktop | 97/97/100/100→97/97/100/100 | 1170→1175 | 0.0018→0.0016 | 0→4 | 750→755 | 750→774 | 833609→833635 | 593444→593444 |
| admin-session | mobile | 77/100/100/100→78/100/100/100 | 4504→4370 | 0.0272→0.0057 | 0→55 | 3455→3392 | 3455→3392 | 771883→771909 | 560079→560079 |
| admin-session | desktop | 99/96/100/100→98/96/100/100 | 933→1025 | 0.0128→0.0128 | 0→0 | 669→818 | 669→865 | 790877→790903 | 560079→560079 |
| admin-course-grades | mobile | 62/100/100/100→62/100/100/100 | 5855→5856 | 0.2611→0.2611 | 0→0 | 2339→2347 | 2339→2347 | 780430→780456 | 555598→555598 |
| admin-course-grades | desktop | 97/95/100/100→97/95/100/100 | 1170→1171 | 0.0005→0.0005 | 0→0 | 770→771 | 770→771 | 799424→799450 | 555598→555598 |
| admin-group-grades | mobile | 76/100/100/100→69/100/100/100 | 6005→6007 | 0.0019→0.0019 | 0→8 | 2105→3759 | 2105→3759 | 791691→791717 | 555598→555598 |
| admin-group-grades | desktop | 97/96/100/100→97/96/100/100 | 1170→1170 | 0.0187→0.0187 | 0→0 | 770→590 | 770→590 | 810685→810711 | 555598→555598 |
| admin-closure | mobile | 77/100/100/100→71/100/100/100 | 4804→5105 | 0.0288→0.0689 | 0→0 | 3014→3907 | 3014→3907 | 769024→769050 | 486458→486458 |
| admin-closure | desktop | 98/96/100/100→98/96/100/100 | 974→971 | 0.0215→0.0215 | 0→0 | 792→770 | 792→770 | 788019→788045 | 486458→486458 |
| admin-closure-history | mobile | 92/100/100/100→87/100/100/100 | 2557→3171 | 0.0894→0.0894 | 0→3 | 2482→2789 | 2482→2789 | 758206→758232 | 480345→480345 |
| admin-closure-history | desktop | 99/96/100/100→99/96/100/100 | 934→933 | 0.0027→0.0027 | 0→0 | 772→771 | 772→771 | 777200→777226 | 480345→480345 |
| admin-interests | mobile | 77/100/100/100→89/100/100/100 | 4504→3170 | 0.0373→0.0373 | 0→5 | 3455→2788 | 3455→2788 | 730587→730613 | 518610→518610 |
| admin-interests | desktop | 99/96/100/100→99/96/100/100 | 893→892 | 0.0001→0.0001 | 0→0 | 732→731 | 732→731 | 749581→749607 | 518610→518610 |
| admin-interest-detail | mobile | 98/100/100/100→98/100/100/100 | 1955→1955 | 0.0012→0.0012 | 0→0 | 1955→1955 | 1955→1955 | 584186→584212 | 398975→398975 |
| admin-interest-detail | desktop | 99/96/100/100→99/96/100/100 | 893→895 | 0.0002→0.0002 | 0→0 | 731→733 | 731→733 | 622098→622124 | 398975→398975 |
| admin-registrations | mobile | 96/96/100/100→90/96/100/100 | 2256→3021 | 0.0000→0.0000 | 39→47 | 2256→2639 | 2256→2639 | 772709→772735 | 543880→543880 |
| admin-registrations | desktop | 99/96/100/100→99/96/100/100 | 891→891 | 0.0002→0.0002 | 0→0 | 729→729 | 729→748 | 791703→791729 | 543880→543880 |
| admin-registration-new | mobile | 78/100/100/100→89/100/100/100 | 4355→3173 | 0.0005→0.0000 | 0→0 | 3382→2790 | 3382→2790 | 625483→625509 | 423035→423035 |
| admin-registration-new | desktop | 99/95/100/100→99/95/100/100 | 894→892 | 0.0004→0.0004 | 0→0 | 732→731 | 814→731 | 644477→644503 | 423035→423035 |
| admin-payments-detail | mobile | 89/100/100/100→97/100/100/100 | 3173→2105 | 0.0309→0.0309 | 0→0 | 2715→2105 | 2715→2105 | 671592→671618 | 427427→427427 |
| admin-payments-detail | desktop | 98/96/100/100→99/96/100/100 | 977→816 | 0.0018→0.0018 | 0→0 | 774→694 | 774→694 | 690586→690612 | 427427→427427 |
| admin-formats | mobile | 89/95/100/100→89/95/100/100 | 3172→3176 | 0.0212→0.0212 | 0→0 | 2790→2793 | 2790→2793 | 596808→596834 | 393207→393207 |
| admin-formats | desktop | 99/95/100/100→99/95/100/100 | 891→934 | 0.0001→0.0001 | 0→0 | 730→753 | 730→753 | 615802→615828 | 393207→393207 |
| admin-format-new | mobile | 92/100/100/100→89/100/100/100 | 2870→3170 | 0.0006→0.0007 | 0→0 | 2488→2788 | 2488→2788 | 599953→599979 | 397123→397123 |
| admin-format-new | desktop | 99/95/100/100→99/95/100/100 | 933→892 | 0.0001→0.0001 | 0→0 | 752→731 | 752→731 | 618947→618973 | 397123→397123 |
| admin-format-detail | mobile | 78/96/100/100→98/96/100/100 | 4354→1955 | 0.0003→0.0003 | 0→0 | 3305→1955 | 3305→1955 | 630319→630345 | 404453→404453 |
| admin-format-detail | desktop | 99/96/100/100→99/96/100/100 | 892→810 | 0.0002→0.0002 | 0→0 | 731→690 | 731→690 | 649313→649339 | 404453→404453 |
| admin-instructors | mobile | 91/96/100/100→75/96/100/100 | 2869→4655 | 0.0178→0.0178 | 0→2 | 2637→3531 | 2637→3531 | 728688→728714 | 518610→518610 |
| admin-instructors | desktop | 99/96/100/100→99/96/100/100 | 892→931 | 0.0002→0.0002 | 0→0 | 730→730 | 730→730 | 747682→747708 | 518610→518610 |
| admin-instructor-new | mobile | 94/100/100/100→89/100/100/100 | 2561→3173 | 0.0005→0.0005 | 6→0 | 2486→2791 | 2486→2791 | 607394→607420 | 398727→398727 |
| admin-instructor-new | desktop | 99/95/100/100→99/95/100/100 | 892→934 | 0.0001→0.0001 | 0→0 | 730→753 | 730→753 | 626388→626414 | 398727→398727 |
| admin-instructor-edit | mobile | 89/100/100/100→90/100/100/100 | 3170→3022 | 0.0008→0.0008 | 0→0 | 2788→2565 | 2788→2565 | 625017→625043 | 401371→401371 |
| admin-instructor-edit | desktop | 98/96/100/100→99/96/100/100 | 973→772 | 0.0003→0.0003 | 0→0 | 771→671 | 771→671 | 644011→644037 | 401371→401371 |
| admin-users | mobile | 89/96/100/100→93/96/100/100 | 3156→2719 | 0.0004→0.0004 | 0→9 | 2780→2336 | 2780→2336 | 730074→730100 | 518610→518610 |
| admin-users | desktop | 99/96/100/100→99/96/100/100 | 891→892 | 0.0019→0.0019 | 0→0 | 729→730 | 729→730 | 749068→749094 | 518610→518610 |
| admin-user-new | mobile | 95/100/100/100→93/100/100/100 | 2334→2721 | 0.0173→0.0174 | 0→0 | 2334→2338 | 2334→2338 | 602962→602988 | 397236→397236 |
| admin-user-new | desktop | 99/95/100/100→99/95/100/100 | 894→893 | 0.0001→0.0001 | 0→0 | 732→731 | 732→731 | 621956→621982 | 397236→397236 |
| admin-user-detail | mobile | 78/100/100/100→98/100/100/100 | 4354→1955 | 0.0008→0.0008 | 3→0 | 3380→1955 | 3380→1955 | 690262→690288 | 479968→479968 |
| admin-user-detail | desktop | 99/96/100/100→99/96/100/100 | 931→929 | 0.0004→0.0004 | 0→0 | 749→748 | 749→748 | 709256→709282 | 479968→479968 |
| admin-certificates | mobile | 78/100/100/100→78/100/100/100 | 4354→4355 | 0.0003→0.0003 | 0→2 | 3380→3381 | 3380→3381 | 723861→723887 | 518237→518237 |
| admin-certificates | desktop | 99/96/100/100→99/96/100/100 | 892→890 | 0.0001→0.0001 | 0→0 | 730→729 | 730→729 | 742855→742881 | 518237→518237 |
| admin-certificate-detail | mobile | 75/96/100/100→93/96/100/100 | 4654→2561 | 0.0298→0.0299 | 0→0 | 3605→2561 | 3605→2561 | 727658→727682 | 487420→487420 |
| admin-certificate-detail | desktop | 98/96/100/100→98/96/100/100 | 978→976 | 0.0093→0.0093 | 0→0 | 794→793 | 794→793 | 746650→746677 | 487420→487420 |
| admin-group-certificates | mobile | 91/100/100/100→98/100/100/91 | 2871→1959 | 0.0021→0.0021 | 0→0 | 2639→1959 | 2639→1959 | 593885→593911 | 392546→392546 |
| admin-group-certificates | desktop | 99/95/100/100→98/95/100/100 | 929→973 | 0.0004→0.0004 | 0→0 | 749→773 | 749→773 | 612879→612905 | 392546→392546 |
| admin-settings | mobile | 68/100/100/100→83/100/100/100 | 5704→3626 | 0.0494→0.0001 | 0→0 | 4354→3242 | 4354→3242 | 802236→802262 | 512937→512937 |
| admin-settings | desktop | 98/96/100/100→98/96/100/100 | 1016→1018 | 0.0013→0.0013 | 0→0 | 833→834 | 833→834 | 821230→821256 | 512937→512937 |
| admin-profile | mobile | 91/100/100/100→92/100/100/100 | 2959→2875 | 0.0000→0.0010 | 5→0 | 2541→2416 | 2541→2416 | 610444→610470 | 402948→402948 |
| admin-profile | desktop | 98/96/100/100→98/96/100/100 | 1008→979 | 0.0001→0.0001 | 0→0 | 796→777 | 796→777 | 629438→629464 | 402948→402948 |
| admin-password | mobile | 82/100/100/100→93/100/100/100 | 3930→2724 | 0.0003→0.0003 | 16→0 | 2948→2340 | 2948→2340 | 645104→645130 | 436340→436340 |
| admin-password | desktop | 99/95/100/100→99/95/100/100 | 931→895 | 0.0000→0.0000 | 0→0 | 755→733 | 868→733 | 664098→664124 | 436340→436340 |

## Claves de ruta

- **landing**: `/`
- **catalog**: `/cursos`
- **course**: `/cursos/analisis-de-datos-con-python`
- **login**: `/login`
- **verification**: `/certificados/:publicCredentialId`
- **admin-courses**: `/app/cursos`
- **admin-course-new**: `/app/cursos/nuevo`
- **admin-course-edit**: `/app/cursos/:id/editar`
- **admin-groups**: `/app/cursos/:id/grupos`
- **admin-participants**: `/app/cursos/:id/grupos/:id/participantes`
- **admin-sessions**: `/app/cursos/:id/grupos/:id/sesiones`
- **admin-session**: `/app/cursos/:id/grupos/:id/sesiones/:id`
- **admin-course-grades**: `/app/cursos/:id/evaluaciones`
- **admin-group-grades**: `/app/cursos/:id/grupos/:id/evaluaciones`
- **admin-closure**: `/app/cursos/:id/grupos/:id/cierre`
- **admin-closure-history**: `/app/cursos/:id/grupos/:id/cierre/2`
- **admin-interests**: `/app/interesados`
- **admin-interest-detail**: `/app/interesados/:id`
- **admin-registrations**: `/app/preinscripciones`
- **admin-registration-new**: `/app/preinscripciones/nueva`
- **admin-payments-detail**: `/app/preinscripciones/:id`
- **admin-formats**: `/app/formatos`
- **admin-format-new**: `/app/formatos/nuevo`
- **admin-format-detail**: `/app/formatos/:id`
- **admin-instructors**: `/app/instructores`
- **admin-instructor-new**: `/app/instructores/nuevo`
- **admin-instructor-edit**: `/app/instructores/:id/editar`
- **admin-users**: `/app/administradores`
- **admin-user-new**: `/app/administradores/nuevo`
- **admin-user-detail**: `/app/administradores/:id`
- **admin-certificates**: `/app/certificados`
- **admin-certificate-detail**: `/app/certificados/:id`
- **admin-group-certificates**: `/app/cursos/:id/grupos/:id/certificados`
- **admin-settings**: `/app/configuracion`
- **admin-profile**: `/app/perfil`
- **admin-password**: `/app/perfil/contrasena`

Los IDs reales quedan solo en evidencia privada externa. Dos aliases GET de configuración redirigen al panel combinado y no reciben puntuación independiente. Informes y pagos se inventarían desde Cursos/Preinscripciones: los informes PDF/CSV son descargas, pagos es parte de la ficha. No se ejecutaron escrituras de negocio.
