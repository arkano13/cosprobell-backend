# Certificado fijado del puente

La validación TLS habitual sigue activa por defecto. Para aceptar explícitamente un certificado vencido o cuyo nombre no coincide, también en producción, configurar en el equipo del puente:

```dotenv
SAP_TLS_TEST_EXCEPTION=false
SAP_TLS_PINNED_CERTIFICATE=true
SAP_TLS_CERT_SHA256=HUELLA_SHA256_CONFIRMADA_DEL_SERVIDOR
```

La conexión conserva HTTPS y verifica la huella exacta antes de enviar credenciales. Este modo omite vigencia, nombre y cadena de confianza del certificado. Confirmar la huella con sistemas por un canal independiente; no aceptar automáticamente una huella nueva si falla la conexión. Al renovar el certificado, volver a la validación habitual con `SAP_TLS_PINNED_CERTIFICATE=false` y la cadena de confianza correspondiente, o verificar y actualizar la huella explícitamente.

La excepción antigua `SAP_TLS_TEST_EXCEPTION` continúa limitada a XPRUEBAS2026, salvo activación explícita del nuevo modo. No se permite `NODE_TLS_REJECT_UNAUTHORIZED=0`. El transporte de Railway no se modifica.

Actualizar `puente/config.js` y `puente/ejecutar.js` con la tarea pausada y sin ejecuciones activas. Conservar el resto de la instalación, incluido el lanzador oculto, estado y configuración. Ejecutar primero `ejecutar-puente.cmd --sondeo` y revisar el log. Esta modificación no cambia de sociedad ni autoriza mezclar datos de pruebas y producción: preparar ese cambio por separado con estado y destino coherentes.
