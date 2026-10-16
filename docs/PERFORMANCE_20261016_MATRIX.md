# Matriz Lighthouse — 2026-10-16

Complementa [metodología y límites](PERFORMANCE_20261016.md). 72 pares baseline→combinado final, misma máquina, build de producción, cuatro categorías. Baseline7a19a468; implementación3a2a7b24 sobre development7b397124 (PR423/424/425/426 más esta optimización). La comparación NO aísla cambios de esos PRs; comparación aislada histórica en evidencia externa after-matrix.json. Una muestra por par: no comparar pequeñas variaciones como mejoras causales. P/A/BP/SEO son puntuaciones; LCP/FCP/TBT/SI en ms, CLS sin unidad, transferencia/JS en bytes. ADMIN tiene sesión SSR legítima, HTTP200 y URL final exacta; SEO100 en baseline corresponde a ausencia de noindex, corregida por PR423 y no una recomendación. Verificación pública conserva noindex correcto.

| Ruta                     | Dispositivo | P/A/BP/SEO antes→después        |       LCP |           CLS |   TBT |       FCP |        SI | Transferencia |            JS |
| ------------------------ | ----------- | ------------------------------- | --------: | ------------: | ----: | --------: | --------: | ------------: | ------------: |
| landing                  | mobile      | 92/96/100/100→92/96/100/92      | 2861→2859 | 0.0016→0.0013 |   0→0 | 2411→2409 | 2411→2409 | 352236→351670 |     2627→2627 |
| landing                  | desktop     | 100/96/100/100→100/96/100/100   |   690→687 | 0.0010→0.0010 |   0→0 |   555→551 |   555→551 | 465831→465290 |     2627→2627 |
| catalog                  | mobile      | 95/100/100/100→96/100/100/100   | 2411→2331 | 0.0026→0.0007 |   0→0 | 2336→2256 | 2336→2256 | 201005→201658 |     2627→2627 |
| catalog                  | desktop     | 100/100/100/100→100/100/100/100 |   548→546 | 0.0020→0.0008 |   0→0 |   548→546 |   548→546 | 201005→201658 |     2627→2627 |
| course                   | mobile      | 92/100/100/100→97/100/100/100   | 2900→2108 | 0.0023→0.0023 |   7→0 | 2281→2033 | 2281→2033 | 686804→686893 | 507518→506826 |
| course                   | desktop     | 99/100/100/100→100/100/100/100  |   895→730 | 0.0020→0.0020 |   0→0 |   719→650 |   719→650 | 705662→705751 | 507518→506826 |
| login                    | mobile      | 93/95/100/100→80/100/100/60     | 1968→4206 | 0.1302→0.0005 |   8→0 | 1968→3082 | 1968→3082 | 589872→589405 | 431273→430796 |
| login                    | desktop     | 99/95/100/100→100/100/100/60    |   851→646 | 0.0001→0.0259 |   0→0 |   653→547 |   653→547 | 589872→589405 | 431273→430796 |
| verification             | mobile      | 95/100/100/60→79/100/100/60     | 2409→4205 | 0.0218→0.0381 |   0→0 | 2334→3231 | 2334→3231 | 219797→598502 |   6227→379698 |
| verification             | desktop     | 100/100/100/60→100/100/100/60   |   529→528 | 0.0180→0.0045 |   0→0 |   529→528 |   529→528 | 219797→598502 |   6227→379698 |
| admin-courses            | mobile      | 76/96/100/100→92/96/100/60      | 4565→2872 | 0.0008→0.0008 |   8→1 | 3563→2490 | 3563→2490 | 774073→773939 | 521519→520866 |
| admin-courses            | desktop     | 98/96/100/100→99/96/100/60      |  1011→892 | 0.0003→0.0003 |   0→0 |   813→731 |   813→731 | 793067→792933 | 521519→520866 |
| admin-course-new         | mobile      | 74/96/100/100→75/96/100/60      | 4848→4678 | 0.0000→0.0011 |   0→0 | 3705→3695 | 3705→3695 | 913703→913305 | 657332→656415 |
| admin-course-new         | desktop     | 97/96/100/100→96/96/100/60      | 1046→1014 | 0.0163→0.0959 |   0→0 |   835→752 |   934→752 | 932697→932299 | 657332→656415 |
| admin-course-edit        | mobile      | 72/96/100/100→96/96/100/60      | 5105→2257 | 0.0023→0.0023 |   1→0 | 3982→2257 | 3982→2257 | 927467→927069 | 663437→662520 |
| admin-course-edit        | desktop     | 86/96/100/100→87/96/100/60      | 1025→1144 | 0.2390→0.2073 |   0→0 |   757→899 |   757→899 | 946461→946063 | 663437→662520 |
| admin-groups             | mobile      | 78/100/100/100→80/100/100/60    | 2408→2258 | 0.3351→0.3351 |   0→0 | 2408→2258 | 2408→2258 | 639492→639700 | 405078→404767 |
| admin-groups             | desktop     | 99/96/100/100→99/96/100/60      |   895→893 | 0.0146→0.0146 |   0→0 |   733→731 |   733→731 | 658486→658694 | 405078→404767 |
| admin-participants       | mobile      | 75/100/100/100→82/100/100/60    | 3172→2335 | 0.2626→0.2626 |   0→0 | 2790→2335 | 2790→2335 | 600909→601117 | 394670→394359 |
| admin-participants       | desktop     | 99/96/100/100→99/96/100/60      |   930→891 | 0.0009→0.0009 |   0→0 |   749→730 |   749→730 | 619903→620111 | 394670→394359 |
| admin-sessions           | mobile      | 77/96/100/100→77/96/100/60      | 5855→5855 | 0.0352→0.0352 | 14→10 | 1955→1955 | 1955→1955 | 814615→814437 | 593444→592747 |
| admin-sessions           | desktop     | 97/97/100/100→97/97/100/60      | 1170→1170 | 0.0018→0.0018 |   0→0 |   750→750 |   750→750 | 833609→833431 | 593444→592747 |
| admin-session            | mobile      | 77/100/100/100→77/100/100/60    | 4504→4505 | 0.0272→0.0272 |   0→3 | 3455→3457 | 3455→3457 | 771883→771584 | 560079→559261 |
| admin-session            | desktop     | 99/96/100/100→99/96/100/60      |   933→930 | 0.0128→0.0128 |   0→0 |   669→729 |   669→729 | 790877→790578 | 560079→559261 |
| admin-course-grades      | mobile      | 62/100/100/100→59/100/100/60    | 5855→5706 | 0.2611→0.2611 |   0→0 | 2339→3382 | 2339→3382 | 780430→780257 | 555598→554906 |
| admin-course-grades      | desktop     | 97/95/100/100→97/95/100/60      | 1170→1210 | 0.0005→0.0005 |   0→0 |   770→691 |   770→691 | 799424→799251 | 555598→554906 |
| admin-group-grades       | mobile      | 76/100/100/100→76/100/100/60    | 6005→6005 | 0.0019→0.0019 |   0→0 | 2105→2105 | 2105→2105 | 791691→791518 | 555598→554906 |
| admin-group-grades       | desktop     | 97/96/100/100→97/96/100/60      | 1170→1171 | 0.0187→0.0187 |   0→0 |   770→771 |   770→771 | 810685→810512 | 555598→554906 |
| admin-closure            | mobile      | 77/100/100/100→70/100/100/60    | 4804→5255 | 0.0288→0.0689 |   0→0 | 3014→3981 | 3014→3981 | 769024→769267 | 486458→486181 |
| admin-closure            | desktop     | 98/96/100/100→98/96/100/60      |   974→974 | 0.0215→0.0215 |   0→0 |   792→792 |   792→792 | 788019→788262 | 486458→486181 |
| admin-closure-history    | mobile      | 92/100/100/100→72/100/100/60    | 2557→4805 | 0.0894→0.0894 |   0→0 | 2482→3756 | 2482→3756 | 758206→758531 | 480345→480151 |
| admin-closure-history    | desktop     | 99/96/100/100→99/96/100/60      |   934→935 | 0.0027→0.0027 |   0→0 |   772→773 |   772→773 | 777200→777525 | 480345→480151 |
| admin-interests          | mobile      | 77/100/100/100→98/100/100/60    | 4504→1955 | 0.0373→0.0373 |   0→0 | 3455→1955 | 3455→1955 | 730587→730453 | 518610→517957 |
| admin-interests          | desktop     | 99/96/100/100→99/96/100/60      |   893→891 | 0.0001→0.0001 |   0→0 |   732→729 |   732→729 | 749581→749447 | 518610→517957 |
| admin-interest-detail    | mobile      | 98/100/100/100→95/100/100/60    | 1955→2406 | 0.0012→0.0012 |   0→0 | 1955→2406 | 1955→2406 | 584186→584394 | 398975→398664 |
| admin-interest-detail    | desktop     | 99/96/100/100→99/96/100/60      |   893→892 | 0.0002→0.0002 |   0→0 |   731→730 |   731→730 | 622098→622306 | 398975→398664 |
| admin-registrations      | mobile      | 96/96/100/100→97/96/100/60      | 2256→2104 | 0.0000→0.0000 | 39→55 | 2256→2104 | 2256→2104 | 772709→773365 | 543880→544017 |
| admin-registrations      | desktop     | 99/96/100/100→99/96/100/60      |   891→892 | 0.0002→0.0002 |   0→0 |   729→730 |   729→741 | 791703→792359 | 543880→544017 |
| admin-registration-new   | mobile      | 78/100/100/100→77/100/100/60    | 4355→4504 | 0.0005→0.0000 |   0→0 | 3382→3455 | 3382→3455 | 625483→626442 | 423035→423475 |
| admin-registration-new   | desktop     | 99/95/100/100→99/95/100/60      |   894→769 | 0.0004→0.0004 |   0→0 |   732→669 |   814→669 | 644477→645436 | 423035→423475 |
| admin-payments-detail    | mobile      | 89/100/100/100→96/100/100/60    | 3173→2258 | 0.0309→0.0309 |   0→0 | 2715→2258 | 2715→2258 | 671592→672551 | 427427→427867 |
| admin-payments-detail    | desktop     | 98/96/100/100→98/96/100/60      |   977→974 | 0.0018→0.0018 |   0→0 |   774→772 |   774→772 | 690586→691545 | 427427→427867 |
| admin-formats            | mobile      | 89/95/100/100→89/95/100/60      | 3172→3176 | 0.0212→0.0212 |   0→0 | 2790→2794 | 2790→2794 | 596808→597016 | 393207→392896 |
| admin-formats            | desktop     | 99/95/100/100→99/95/100/60      |   891→934 | 0.0001→0.0001 |   0→0 |   730→752 |   730→752 | 615802→616010 | 393207→392896 |
| admin-format-new         | mobile      | 92/100/100/100→98/100/100/60    | 2870→1955 | 0.0006→0.0007 |   0→0 | 2488→1955 | 2488→1955 | 599953→600161 | 397123→396812 |
| admin-format-new         | desktop     | 99/95/100/100→99/95/100/60      |   933→892 | 0.0001→0.0001 |   0→0 |   752→730 |   752→730 | 618947→619155 | 397123→396812 |
| admin-format-detail      | mobile      | 78/96/100/100→95/96/100/60      | 4354→2409 | 0.0003→0.0003 |   0→0 | 3305→2334 | 3305→2334 | 630319→630527 | 404453→404142 |
| admin-format-detail      | desktop     | 99/96/100/100→99/96/100/60      |   892→892 | 0.0002→0.0002 |   0→0 |   731→730 |   731→730 | 649313→649521 | 404453→404142 |
| admin-instructors        | mobile      | 91/96/100/100→77/96/100/60      | 2869→4504 | 0.0178→0.0178 |   0→0 | 2637→3455 | 2637→3455 | 728688→728554 | 518610→517957 |
| admin-instructors        | desktop     | 99/96/100/100→99/96/100/60      |   892→890 | 0.0002→0.0002 |   0→0 |   730→729 |   730→729 | 747682→747548 | 518610→517957 |
| admin-instructor-new     | mobile      | 94/100/100/100→97/100/100/60    | 2561→2107 | 0.0005→0.0006 |   6→0 | 2486→2107 | 2486→2107 | 607394→607602 | 398727→398416 |
| admin-instructor-new     | desktop     | 99/95/100/100→99/95/100/60      |   892→895 | 0.0001→0.0001 |   0→0 |   730→733 |   730→733 | 626388→626596 | 398727→398416 |
| admin-instructor-edit    | mobile      | 89/100/100/100→97/100/100/60    | 3170→2106 | 0.0008→0.0008 |   0→0 | 2788→2031 | 2788→2031 | 625017→625225 | 401371→401060 |
| admin-instructor-edit    | desktop     | 98/96/100/100→99/96/100/60      |   973→933 | 0.0003→0.0003 |   0→0 |   771→751 |   771→751 | 644011→644219 | 401371→401060 |
| admin-users              | mobile      | 89/96/100/100→98/96/100/60      | 3156→1953 | 0.0004→0.0004 |   0→2 | 2780→1953 | 2780→1953 | 730074→729940 | 518610→517957 |
| admin-users              | desktop     | 99/96/100/100→98/96/100/60      |   891→970 | 0.0019→0.0019 |   0→0 |   729→729 |   729→729 | 749068→748934 | 518610→517957 |
| admin-user-new           | mobile      | 95/100/100/100→95/100/100/60    | 2334→2332 | 0.0173→0.0174 |   0→0 | 2334→2332 | 2334→2332 | 602962→603170 | 397236→396925 |
| admin-user-new           | desktop     | 99/95/100/100→99/95/100/60      |   894→892 | 0.0001→0.0001 |   0→0 |   732→731 |   732→731 | 621956→622164 | 397236→396925 |
| admin-user-detail        | mobile      | 78/100/100/100→92/100/100/60    | 4354→2874 | 0.0008→0.0008 |   3→0 | 3380→2491 | 3380→2491 | 690262→690255 | 479968→479442 |
| admin-user-detail        | desktop     | 99/96/100/100→99/96/100/60      |   931→932 | 0.0004→0.0004 |   0→0 |   749→750 |   749→750 | 709256→709249 | 479968→479442 |
| admin-certificates       | mobile      | 78/100/100/100→78/100/100/60    | 4354→4354 | 0.0003→0.0003 |   0→3 | 3380→3380 | 3380→3380 | 723861→723727 | 518237→517584 |
| admin-certificates       | desktop     | 99/96/100/100→99/96/100/60      |   892→769 | 0.0001→0.0001 |   0→0 |   730→669 |   730→669 | 742855→742721 | 518237→517584 |
| admin-certificate-detail | mobile      | 75/96/100/100→75/96/100/60      | 4654→4654 | 0.0298→0.0299 |   0→0 | 3605→3605 | 3605→3605 | 727658→728402 | 487420→488094 |
| admin-certificate-detail | desktop     | 98/96/100/100→98/96/100/60      |   978→974 | 0.0093→0.0093 |   0→0 |   794→792 |   794→792 | 746650→747396 | 487420→488094 |
| admin-group-certificates | mobile      | 91/100/100/100→89/100/100/60    | 2871→3171 | 0.0021→0.0021 |   0→0 | 2639→2789 | 2639→2789 | 593885→594093 | 392546→392235 |
| admin-group-certificates | desktop     | 99/95/100/100→99/95/100/60      |   929→929 | 0.0004→0.0004 |   0→0 |   749→749 |   749→749 | 612879→613087 | 392546→392235 |
| admin-settings           | mobile      | 68/100/100/100→93/100/100/60    | 5704→2554 | 0.0494→0.0494 |   0→0 | 4354→2479 | 4354→2479 | 802236→802196 | 512937→512378 |
| admin-settings           | desktop     | 98/96/100/100→98/96/100/60      | 1016→1012 | 0.0013→0.0013 |   0→0 |   833→830 |   833→830 | 821230→821190 | 512937→512378 |
| admin-profile            | mobile      | 91/100/100/100→96/100/100/60    | 2959→2260 | 0.0000→0.0010 |   5→0 | 2541→2185 | 2541→2185 | 610444→610652 | 402948→402637 |
| admin-profile            | desktop     | 98/96/100/100→99/96/100/60      |  1008→935 | 0.0001→0.0001 |   0→0 |   796→753 |   796→753 | 629438→629646 | 402948→402637 |
| admin-password           | mobile      | 82/100/100/100→98/100/100/60    | 3930→1955 | 0.0003→0.0003 |  16→0 | 2948→1955 | 2948→1955 | 645104→645146 | 436340→435863 |
| admin-password           | desktop     | 99/95/100/100→99/95/100/60      |   931→892 | 0.0000→0.0000 |   0→0 |   755→731 |   868→731 | 664098→664140 | 436340→435863 |

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
